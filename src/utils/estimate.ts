export default function estimate(seconds: number) {
  return { minutes: Math.max(1, Math.ceil(seconds / 60)) };
}
