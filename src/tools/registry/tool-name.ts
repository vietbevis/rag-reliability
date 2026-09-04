/**
 * `ToolId` canonical dùng dấu chấm (`rag.search`, `actvn-mcp.student_search`)
 * nhưng tên hàm tool-calling của OpenAI/Anthropic chỉ cho `^[a-zA-Z0-9_-]{1,64}$`
 * — không có dấu chấm. Quy đổi 2 chiều, tất định.
 */
const DOT = /\./g;
const SEP = /__/g;

export function toolIdToSpecName(id: string): string {
  return id.replace(DOT, '__');
}

export function specNameToToolId(name: string): string {
  return name.replace(SEP, '.');
}
