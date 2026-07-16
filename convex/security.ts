export function assertServiceKey(serviceKey: string) {
  const expected = process.env.PLATEPOST_CONVEX_SERVICE_KEY;
  if (!expected || !serviceKey || expected.length !== serviceKey.length) {
    throw new Error("Unauthorized");
  }

  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ serviceKey.charCodeAt(index);
  }
  if (difference !== 0) throw new Error("Unauthorized");
}
