function safeBigInt(v) {
  try {
    if (!v) return BigInt(0);
    return BigInt(v);
  } catch {
    return BigInt(0);
  }
}

// Flow #1: linear vesting starts AFTER the cliff (no jump at cliff).
function releasedAt(params) {
  const { t, start, cliffSeconds, durationSeconds, amount } = params;
  if (amount <= BigInt(0)) return BigInt(0);
  if (durationSeconds <= BigInt(0)) return BigInt(0);

  const cliffTime = start + cliffSeconds;
  const endTime = start + durationSeconds;

  if (t < cliffTime) return BigInt(0);
  if (t >= endTime) return amount;

  const linearDuration = durationSeconds - cliffSeconds;
  if (linearDuration <= BigInt(0)) return amount;
  const elapsedSinceCliff = t - cliffTime;
  if (elapsedSinceCliff <= BigInt(0)) return BigInt(0);

  return (amount * elapsedSinceCliff) / linearDuration;
}

function buildSampleTimes(params) {
  const { start, cliffSeconds, durationSeconds, maxPoints } = params;
  const cliffTime = start + cliffSeconds;
  const endTime = start + durationSeconds;

  const times = [];
  times.push(start);
  times.push(cliffTime);
  times.push(endTime);

  const range = endTime > start ? endTime - start : BigInt(0);
  if (range <= BigInt(0)) {
    const uniq = Array.from(new Set(times.map((x) => x.toString()))).map((s) => BigInt(s));
    uniq.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return uniq;
  }

  const max = Math.max(10, Math.min(500, Math.floor(maxPoints)));
  const minStep = BigInt(3600); // 1h
  let step = range / BigInt(max - 1);
  if (step < minStep) step = minStep;

  for (let t = start; t <= endTime; t += step) {
    times.push(t);
    if (step === BigInt(0)) break;
  }
  times.push(endTime);

  const uniq = Array.from(new Set(times.map((x) => x.toString()))).map((s) => BigInt(s));
  uniq.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return uniq;
}

export function buildVaultReleaseCurve(params) {
  const amount = typeof params.amount === "bigint" ? params.amount : safeBigInt(String(params.amount));
  const start = typeof params.vestingStart === "bigint" ? params.vestingStart : safeBigInt(String(params.vestingStart));
  const cliffSeconds =
    typeof params.vestingCliffSeconds === "bigint"
      ? params.vestingCliffSeconds
      : safeBigInt(String(params.vestingCliffSeconds));
  const durationSeconds =
    typeof params.vestingDurationSeconds === "bigint"
      ? params.vestingDurationSeconds
      : safeBigInt(String(params.vestingDurationSeconds));

  const times = buildSampleTimes({
    start,
    cliffSeconds,
    durationSeconds,
    maxPoints: params.maxPoints ?? 180,
  });

  const points = times.map((t) => ({
    t: Number(t), // unix seconds
    releasedRaw: releasedAt({ t, start, cliffSeconds, durationSeconds, amount }).toString(),
  }));

  return {
    vaultAddress: params.vaultAddress,
    points,
  };
}

