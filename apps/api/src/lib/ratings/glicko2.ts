import { defaultRatingConfig, type RatingConfig } from "./config.js";

const TAU = 0.5;
const EPSILON = 1e-6;

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi ** 2) / Math.PI ** 2);
}

function expected(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

function toMu(rating: number): number {
  return (rating - 1500) / 173.7178;
}

function toPhi(rd: number): number {
  return rd / 173.7178;
}

function toRating(mu: number): number {
  return mu * 173.7178 + 1500;
}

function toRd(phi: number): number {
  return phi * 173.7178;
}

export function inflateRd(rd: number, days: number, config: RatingConfig = defaultRatingConfig): number {
  if (!config.g2RdIncreasePerDay) {
    return rd;
  }
  const clampedDays = Math.max(0, days);
  if (clampedDays === 0) {
    return rd;
  }
  const c = config.g2RdIncreasePerDay;
  return Math.min(Math.sqrt(rd * rd + c * c * clampedDays), config.g2DefaultRd);
}

function f(x: number, delta: number, phi: number, v: number, a: number, tau: number): number {
  const ex = Math.exp(x);
  const num = ex * (delta * delta - phi * phi - v - ex);
  const den = 2 * (phi * phi + v + ex) ** 2;
  return num / den - (x - a) / (tau * tau);
}

export type GlickoProfile = {
  rating: number;
  rd: number;
  vol: number;
  lastGameDate: string | null;
};

function daysBetween(previous: string | null, current: string): number {
  if (!previous) {
    return 0;
  }
  const previousTime = Date.parse(`${previous}T00:00:00.000Z`);
  const currentTime = Date.parse(`${current}T00:00:00.000Z`);
  if (Number.isNaN(previousTime) || Number.isNaN(currentTime)) {
    return 0;
  }
  return Math.max(0, Math.floor((currentTime - previousTime) / 86_400_000));
}

export function glicko2Update(
  player: GlickoProfile,
  opponent: GlickoProfile,
  score: number,
  matchDate: string,
  options: { tau?: number; config?: RatingConfig } = {}
): GlickoProfile {
  const tau = options.tau ?? TAU;
  const config = options.config ?? defaultRatingConfig;
  const days = daysBetween(player.lastGameDate, matchDate);
  const opponentDays = daysBetween(opponent.lastGameDate, matchDate);

  const mu = toMu(player.rating);
  const rdStar =
    days && config.g2RdIncreasePerDay
      ? Math.sqrt(player.rd * player.rd + config.g2RdIncreasePerDay * config.g2RdIncreasePerDay * days)
      : player.rd;
  const phi = toPhi(rdStar);
  const muJ = toMu(opponent.rating);
  const phiJ = toPhi(inflateRd(opponent.rd, opponentDays, config));

  const gValue = g(phiJ);
  const eValue = expected(mu, muJ, phiJ);
  const v = 1 / (gValue * gValue * eValue * (1 - eValue));
  const delta = v * gValue * (score - eValue);

  const a = Math.log(player.vol * player.vol);
  let aCandidate = a;
  let bCandidate: number;
  if (delta * delta > phi * phi + v) {
    bCandidate = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau, delta, phi, v, a, tau) < 0) {
      k += 1;
    }
    bCandidate = a - k * tau;
  }

  let fA = f(aCandidate, delta, phi, v, a, tau);
  let fB = f(bCandidate, delta, phi, v, a, tau);
  let iterations = 0;

  while (Math.abs(bCandidate - aCandidate) > EPSILON && iterations < 60) {
    const cCandidate = aCandidate + ((aCandidate - bCandidate) * fA) / (fB - fA);
    const fC = f(cCandidate, delta, phi, v, a, tau);
    if (fC * fB < 0) {
      aCandidate = bCandidate;
      fA = fB;
      bCandidate = cCandidate;
      fB = fC;
    } else {
      fA /= 2;
      bCandidate = cCandidate;
      fB = fC;
    }
    iterations += 1;
  }

  const newSigma = Math.abs(bCandidate - aCandidate) > EPSILON ? player.vol : Math.exp(aCandidate / 2);
  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * gValue * (score - eValue);

  return {
    rating: toRating(muPrime),
    rd: toRd(phiPrime),
    vol: newSigma,
    lastGameDate: matchDate
  };
}
