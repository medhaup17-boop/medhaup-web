/** R2 PDFs carry Content-Disposition on the object; keep signed/external URLs intact. */
export function getFileDownloadUrl(fileUrl: string): string {
  return fileUrl;
}
