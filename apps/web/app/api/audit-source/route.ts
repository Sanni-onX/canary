import bundle from '../../../../../audit/qcai/source.json';
export function GET() {
  return new Response(bundle.source, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}
