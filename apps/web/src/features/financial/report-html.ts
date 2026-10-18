/** Export the rendered, captured report only; no extra API calls or recalculation. */
export function reportHtml(article: HTMLElement, locale: string) {
  const copy = article.cloneNode(true) as HTMLElement
  copy.querySelectorAll('.report-toolbar,button').forEach((node) => node.remove())
  return `<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>AIC Financial Health Summary</title><style>
  body{font:14px/1.5 'Segoe UI',Arial,sans-serif;color:#19332e;margin:32px}article{max-width:1200px;margin:auto}h1{font-size:28px}h3{margin-top:28px}table{border-collapse:collapse;width:100%;font-size:12px;margin:16px 0}th,td{border:1px solid #ccd8d2;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eef4f1}small{display:block;color:#4e635f}blockquote{border-left:3px solid #789;padding:8px 16px;white-space:pre-wrap}.warning-banner{background:#fff6e6;padding:12px;border:1px solid #b58b42}code{overflow-wrap:anywhere}.report-fact{border-bottom:1px solid #ccd8d2;padding:12px 0;break-inside:avoid}caption{text-align:left;font-size:15px;font-weight:bold;padding:12px 0}@page{size:A4 landscape;margin:14mm}@media print{body{margin:0}tr{break-inside:avoid}thead{display:table-header-group}table{table-layout:fixed}}
  </style><body>${copy.outerHTML}</body></html>`
}
