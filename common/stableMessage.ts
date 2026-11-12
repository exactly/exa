export default function stableMessage(message: string) {
  return message
    .replace(/\n[\s\S]*/, "")
    .replaceAll(/\b[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\b/gi, "<id>")
    .replaceAll(/\b(?:0x)?[\da-f]{16,}\b/gi, "<id>");
}
