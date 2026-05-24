# Spec 1: Authenticated Club Access And Role-Scoped Membership

## Implementation Status

Implemented in May 2026.

The implementation enforces authenticated access for club-scoped API routes, makes `GET /clubs` return only the authenticated user's memberships, centralizes role hierarchy checks, preserves private join-by-club-name requests, and updates API tests to use seeded sessions with the production `sid` cookie. The Google SDK is mocked only at the OAuth network boundary.

## Context

The app is designed around authenticated users managing chess clubs. A user can belong to multiple clubs, and a club can have multiple users with different roles. Today, `GET /clubs` can return all clubs when the requester is unauthenticated because route behavior depends on `REQUIRE_AUTH`. That flag mainly exists to make tests pass without proper authenticated integration flows, but it creates an authorization gap.

Live database inspection showed the current development data is not orphaned: the existing club belongs to the existing user through `club_memberships`. The problem is application access control and test strategy, not broken data.

This repo has a strict single-source-of-truth rule. Authorization logic must not be duplicated across routes and services.

## Goals

- Make club and club-scoped data authenticated by default.
- Ensure `GET /clubs` returns only clubs the current authenticated user belongs to.
- Keep `club_memberships` as the only source of truth for club ownership and membership.
- Preserve the existing cumulative role model: `member`, `organizer`, `admin`, `owner`.
- Replace scattered role arrays with one canonical role hierarchy helper.
- Make tests exercise authenticated route behavior without real Google login.
- Keep club discovery private: users request to join by typing a club name, without receiving a public club list.

## Non-Goals

- Do not add `owner_user_id` or similar ownership columns to `clubs`.
- Do not remove the `organizer` enum value.
- Do not use a real Google account in automated tests.
- Do not add a public global club directory.
- Do not implement a full GDPR/privacy settings UI in this spec.

## Product Rules

### Club Membership

- A user can be a member of many clubs.
- A club can have many users.
- A club can have multiple owners.
- A club should always have at least one owner.
- A user account may be linked to players in multiple clubs.

### Role Hierarchy

Roles are cumulative:

```text
member    -> visualize club data
organizer -> member + create/manage tournaments and create players from inside tournament setup
admin     -> organizer + accept/reject memberships and link/unlink accounts
owner     -> admin + delete club and manage owner-level controls
```

Canonical order:

```ts
member < organizer < admin < owner
```

The implementation should provide a single helper, for example:

```ts
export const clubRoleRank = {
  member: 0,
  organizer: 1,
  admin: 2,
  owner: 3
} as const;

export function hasClubRoleAtLeast(actual: ClubRole, required: ClubRole): boolean {
  return clubRoleRank[actual] >= clubRoleRank[required];
}
```

Route guards should require a minimum role, not duplicated role arrays.

Examples:

- View club data: at least `member`
- Create tournament: at least `organizer`
- Create player from tournament setup: at least `organizer`
- Accept join request: at least `admin`
- Link/unlink account: at least `admin`
- Delete club: `owner`

## Current Findings

- `club_role` enum currently is `owner`, `admin`, `organizer`, `member` in both code and Postgres.
- `clubs` has no owner column and should not get one.
- `club_memberships` already has:
  - primary key on `(club_id, user_id)`
  - index on `club_id`
  - index on `user_id`
- `GET /clubs` currently contains route-local SQL and optional membership filtering.
- `apps/api/src/services/clubs.ts` contains overlapping club logic, creating duplication with `apps/api/src/routes/clubs.ts`.
- `.env` currently has `REQUIRE_AUTH=false`.
- `docker-compose.yml` currently does not pass `REQUIRE_AUTH` to the API container.
- `TECH_DEBT.md` already notes that `GET /clubs` authorization behavior is not tested because test auth is disabled.

## Required Design

### Auth Behavior

`REQUIRE_AUTH` must stop controlling protected route behavior.

Protected resources should require authentication unconditionally:

- `/clubs`
- `/clubs/:clubId/**`
- `/players/:id`
- `/tournaments/:id/**`
- `/rounds/:id/**`
- any route that returns or mutates club-scoped data

Public routes may remain public:

- health routes
- OAuth start/callback routes
- logout may remain tolerant of missing session

If keeping `REQUIRE_AUTH` temporarily is necessary during migration, it must not affect production behavior and must not allow anonymous access to club-scoped resources.

### Session And Tests

Do not use a real Google account for integration tests.

Use:

- seeded users
- seeded sessions
- request cookies using the real session cookie name, `sid`
- mocked `google-auth-library` only for OAuth callback tests

The existing test helpers already support seeded users and sessions. Extend or correct them as needed.

Important: tests should use the same cookie name as production auth. Current auth uses `sid`.

### Club Listing

`GET /clubs` becomes "my clubs."

Behavior:

- anonymous request returns `401`
- authenticated non-member returns `200` with `clubs: []`
- authenticated member returns only clubs where they have a `club_memberships` row
- any role qualifies for listing: `member`, `organizer`, `admin`, `owner`
- no public club list should be exposed from this endpoint

Preferred query shape:

Start from `club_memberships` filtered by the authenticated user, then join `clubs`.

Example intent:

```sql
SELECT c.*
FROM club_memberships cm
JOIN clubs c ON c.id = cm.club_id
WHERE cm.user_id = $1
ORDER BY c.name;
```

### Club Creation

Creating a club requires authentication.

Club creation must be transactional:

1. insert club
2. insert `club_memberships` row for creator with role `owner`

If either insert fails, neither should persist.

### Join Requests

Users do not browse a public list of clubs.

Join flow:

- user must be authenticated
- user types a club name
- API returns a generic success response such as "request submitted if found"
- API must not reveal whether a club exists
- if the club exists and user is not already a member, create a pending join request
- duplicate pending requests should not be created
- if the club does not exist, respond the same way and do not create a row

Admin/owner acceptance flow:

- requires at least `admin`
- can link the user to an existing player
- can create a new player while accepting the join request if needed
- accepted user becomes a `member` by default
- accepted join request status becomes `accepted`
- rejected join request status becomes `rejected`

### Player Creation Permissions

Organizer can create players only from inside tournament setup.

Admin can additionally create a player when accepting a join request if no suitable player exists.

General standalone player creation should be reviewed carefully:

- owner may be allowed
- admin may be allowed only if product needs it
- organizer should not create arbitrary club players outside tournament setup

Implement the minimum behavior needed to preserve existing app workflows and enforce the product rules above.

### Member Visibility And Privacy

Members may visualize club data:

- tournaments
- pairings
- standings
- leaderboard
- player display names

Members must not see admin-only identity/account data:

- user emails
- user real names unless intentionally public
- auth identities
- invite metadata
- join request metadata
- linked user IDs where not required for display

Use player `displayName` for member-facing views. Treat account identity data as admin/owner-only.

## Implementation Tasks

### 1. Centralize Role Policy

Create a single role hierarchy helper in the auth layer, likely under `apps/api/src/lib/auth/rbac.ts` or a nearby module.

Required exports:

- `ClubRole`
- `clubRoleRank`
- `hasClubRoleAtLeast(actual, required)`
- guard helper requiring minimum club role

Refactor existing role checks to use minimum-role semantics.

Avoid duplicated arrays such as:

```ts
["owner", "admin", "organizer"]
```

Use:

```ts
requireClubRoleAtLeast("organizer")
```

or equivalent.

### 2. Make Auth Mandatory For Protected Routes

Remove conditional no-op auth from protected routes.

Affected areas include at least:

- clubs routes
- players routes
- tournaments routes
- tournament players routes
- tournament rounds routes
- leaderboard routes
- invite/join request routes

Prefer using the `app.auth` plugin consistently once it provides unconditional protected-route guards.

### 3. Consolidate Club Service Logic

Remove duplicated club CRUD/list logic between routes and services.

One canonical service should own:

- slug generation
- club creation transaction
- list clubs for user
- update club
- delete club
- recompute ratings, if kept in club service

Routes should parse/validate input, call services, and return HTTP responses.

### 4. Update Club List Endpoint

Implement `GET /clubs` as authenticated "my clubs only."

Use current `request.user.id`, not an optional input.

### 5. Update Club Creation

Ensure `POST /clubs`:

- requires auth
- inserts club and owner membership in one transaction
- returns created club
- has tests proving owner membership exists

### 6. Update Join Request Flow

Add or modify endpoint for join-by-club-name.

The current route is `POST /clubs/:clubId/join-requests`, which requires already knowing the `clubId`. This does not match the desired UX.

Add a route such as:

```http
POST /club-join-requests
```

Request:

```json
{
  "clubName": "Clube do Roque",
  "message": "optional"
}
```

Response should be generic even if no club was found.

Keep or remove the existing `POST /clubs/:clubId/join-requests` based on frontend needs, but it must not expose a discovery loophole.

### 7. Index Review

Current indexes are mostly aligned, but review and add indexes based on final queries.

Likely useful indexes:

- `club_memberships(user_id, club_id)` for listing clubs by user and membership checks from user to club
- keep existing primary key `(club_id, user_id)` for uniqueness
- `club_join_requests(club_id, status)` for admin review queues
- `club_join_requests(user_id, status)` for duplicate/current request checks
- `players(club_id, display_name)` already exists as unique
- `tournaments(club_id, name)` already exists as unique
- consider non-unique `tournaments(club_id, status)` if ongoing-tournament checks become frequent
- consider `matches(club_id, played_on, id)` if recompute/listing queries need it

Do not add indexes speculatively without matching query usage.

### 8. Data Migration Notes

No role enum removal is needed.

Before enforcing invariants, check for orphan clubs:

```sql
SELECT c.id, c.name
FROM clubs c
LEFT JOIN club_memberships cm ON cm.club_id = c.id
GROUP BY c.id, c.name
HAVING COUNT(cm.user_id) = 0;
```

Check for clubs without owners:

```sql
SELECT c.id, c.name
FROM clubs c
LEFT JOIN club_memberships cm
  ON cm.club_id = c.id
 AND cm.role = 'owner'
GROUP BY c.id, c.name
HAVING COUNT(cm.user_id) = 0;
```

If any exist, create an explicit backfill plan. Do not silently assign ownership.

### 9. Frontend Updates

Club selector:

- calls `GET /clubs`
- expects only authenticated user's clubs
- handles `401` by directing user to login
- stores selected club only if still present in returned list

Club search/join page:

- should not fetch `/api/clubs`
- should provide typed club-name join request flow
- display generic success for "request submitted if found"

Member views:

- do not display account emails or linked user IDs to members
- use display names

## Required Tests

Add or update API tests using real Postgres and seeded sessions.

### Auth And Clubs

- anonymous `GET /clubs` returns `401`
- authenticated user with no memberships gets `200` and empty `clubs`
- authenticated user sees only clubs where they are a member
- authenticated user does not see clubs owned by another user
- `POST /clubs` anonymous returns `401`
- `POST /clubs` authenticated creates club and owner membership in one transaction

### Role Hierarchy

- `member` can access member-read route
- `member` cannot create tournament
- `organizer` can create tournament
- `organizer` cannot accept join requests
- `admin` can accept join requests
- `admin` cannot delete club
- `owner` can delete club

### Join Requests

- authenticated user can submit join request by club name
- response is generic when club exists
- response is the same generic response when club does not exist
- duplicate pending requests are not created
- existing member cannot create redundant pending request
- admin can accept and link to existing player
- admin can accept and create new player when needed
- accepted user gets `member` role

### Privacy

- member-facing endpoints do not expose user emails
- member-facing endpoints do not expose linked user IDs unless explicitly required and approved
- admin/owner endpoints can access linking information where needed

### Regression

- existing OAuth callback tests continue to mock `google-auth-library`
- route tests do not require real Google network calls
- tests use cookie `sid`, matching production auth

## Acceptance Criteria

- No unauthenticated request can list clubs or access club-scoped data.
- `GET /clubs` always returns only the authenticated user's memberships.
- Club creation always creates an owner membership for the creator.
- Role checks are cumulative and implemented from one canonical helper.
- `organizer` remains in the enum and has a distinct role below `admin`.
- Join requests by club name do not reveal club existence.
- Admins can accept join requests and link/create players as specified.
- Members can visualize club data without seeing account identity metadata.
- Integration tests prove authenticated behavior using seeded sessions, not real Google login.
- No duplicated authorization logic remains between club route and service layers.

## Suggested Next Prompt

```text
Implement the spec in /specs/spec-1-authenticated-club-access.md. Follow AGENTS.md strictly, especially the no duplicated logic rule. Start by centralizing role hierarchy and authenticated club access, then update routes/services/tests.
```
