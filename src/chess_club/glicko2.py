import math

# Compact Glicko-2 implementation for two-player updates.
# Constants
TAU = 0.5
EPSILON = 1e-6
Q = math.log(10) / 400

def _g(phi):
    return 1 / math.sqrt(1 + (3 * (phi ** 2)) / (math.pi ** 2))

def _E(mu, mu_j, phi_j):
    return 1 / (1 + math.exp(-_g(phi_j) * (mu - mu_j)))

def _to_mu(r):
    return (r - 1500.0) / 173.7178

def _to_phi(rd):
    return rd / 173.7178

def _to_rating(mu):
    return mu * 173.7178 + 1500.0

def _to_rd(phi):
    return phi * 173.7178

def _f(x, delta, phi, v, a, tau):
    ex = math.exp(x)
    num = ex * (delta * delta - phi * phi - v - ex)
    den = 2 * (phi * phi + v + ex) ** 2
    return (num / den) - ((x - a) / (tau * tau))

def glicko2_update(r, rd, vol, opp_r, opp_rd, opp_vol, score, tau=TAU):
    # Convert to Glicko-2 scale
    mu = _to_mu(r)
    phi = _to_phi(rd)
    mu_j = _to_mu(opp_r)
    phi_j = _to_phi(opp_rd)

    g = _g(phi_j)
    E = _E(mu, mu_j, phi_j)
    v = 1 / (g * g * E * (1 - E))
    delta = v * g * (score - E)

    a = math.log(vol * vol)
    A = a
    B = None
    if delta * delta > (phi * phi + v):
        B = math.log(delta * delta - phi * phi - v)
    else:
        k = 1
        while _f(a - k * tau, delta, phi, v, a, tau) < 0:
            k += 1
        B = a - k * tau

    fA = _f(A, delta, phi, v, a, tau)
    fB = _f(B, delta, phi, v, a, tau)

    # Binary search for sigma
    while abs(B - A) > EPSILON:
        C = A + (A - B) * fA / (fB - fA)
        fC = _f(C, delta, phi, v, a, tau)
        if fC * fB < 0:
            A = B
            fA = fB
            B = C
            fB = fC
        else:
            fA = fA / 2.0
            B = C
            fB = fC

    new_sigma = math.exp(A / 2.0)

    phi_star = math.sqrt(phi * phi + new_sigma * new_sigma)
    phi_prime = 1 / math.sqrt((1 / (phi_star * phi_star)) + (1 / v))
    mu_prime = mu + (phi_prime * phi_prime) * g * (score - E)

    r_prime = _to_rating(mu_prime)
    rd_prime = _to_rd(phi_prime)

    return r_prime, rd_prime, new_sigma
