import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchJson, postJson, putJson } from "../http.js";

type CreateInviteInput = {
  email: string;
  role?: string;
};

type ProcessJoinRequestInput = {
  action: "accept" | "reject";
  playerId?: string;
};

export function useClubInvites(clubId: string | undefined) {
  return useQuery({
    queryKey: ["clubs", clubId, "invites"],
    queryFn: ({ signal }) => fetchJson<{ invites: any[] }>(`/clubs/${clubId}/invites`, signal),
    enabled: !!clubId,
  });
}

export function useClubJoinRequests(clubId: string | undefined) {
  return useQuery({
    queryKey: ["clubs", clubId, "join-requests"],
    queryFn: ({ signal }) => fetchJson<{ joinRequests: any[] }>(`/clubs/${clubId}/join-requests`, signal),
    enabled: !!clubId,
  });
}

export function useCreateInvite(clubId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateInviteInput) =>
      postJson<{ invite: any; token: string }>(`/clubs/${clubId}/invites`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clubs", clubId, "invites"] });
    },
  });
}

export function useCreateJoinRequest(clubId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { message?: string }) =>
      postJson<{ joinRequest: any }>(`/clubs/${clubId}/join-requests`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clubs", clubId, "join-requests"] });
    },
  });
}

export function useProcessJoinRequest(clubId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ requestId, data }: { requestId: string; data: ProcessJoinRequestInput }) =>
      putJson<{ message: string }>(`/clubs/${clubId}/join-requests/${requestId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clubs", clubId, "join-requests"] });
    },
  });
}
