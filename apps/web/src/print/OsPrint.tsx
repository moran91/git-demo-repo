import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ReceiptModel } from '@qareeb/shared';

/**
 * Fallback layout for the operating-system print dialog / Save as PDF. Rendered from the same
 * validated receipt model. This uses the OS printing stack, not Bluetooth, and a dismissed dialog is
 * never recorded as a successful print.
 */
export function ReceiptHtml({ model }: { model: ReceiptModel }) {
  return (
    <div className="receipt-print" dir={model.dir} lang={model.locale} style={{ width: `${model.printableDots / 8}mm`, maxWidth: '100%' }}>
      {model.blocks.map((b, i) => {
        switch (b.kind) {
          case 'text':
            return <div key={i} style={{ textAlign: b.align === 'center' ? 'center' : b.align === 'end' ? 'end' : 'start', fontWeight: b.bold ? 600 : 400, fontSize: b.size === 'xl' ? '20pt' : b.size === 'lg' ? '15pt' : b.size === 'sm' ? '10pt' : '12pt' }} dir={b.dir === 'ltr' ? 'ltr' : b.dir === 'rtl' ? 'rtl' : 'auto'}>{b.text}</div>;
          case 'row':
            return <div key={i} className="r-row" style={{ fontWeight: b.bold ? 600 : 400, fontSize: b.size === 'lg' ? '15pt' : b.size === 'sm' ? '10pt' : '12pt' }}><span>{b.start}</span><bdi dir="ltr">{b.end}</bdi></div>;
          case 'rule':
            return <hr key={i} />;
          case 'spacer':
            return <div key={i} style={{ height: b.px ?? 8 }} />;
          case 'box':
            return <div key={i} className="r-box">{b.title ? <div style={{ fontSize: '10pt' }}>{b.title}</div> : null}{b.lines.map((l, j) => <div key={j}>{l}</div>)}</div>;
        }
      })}
    </div>
  );
}

/** Opens the OS print dialog for the given model (mounted into the page for the duration). */
export function OsPrintTrigger({ model, onDone }: { model: ReceiptModel; onDone: () => void }) {
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);
  useEffect(() => {
    const after = () => done.current();
    window.addEventListener('afterprint', after, { once: true });
    const id = setTimeout(() => window.print(), 50);
    return () => {
      clearTimeout(id);
      window.removeEventListener('afterprint', after);
    };
  }, [model]);
  // The print stylesheet hides every direct child of #root except .receipt-print/.qr-print, and the
  // dashboard wraps its routes in .business-app — rendering here inline printed a blank page.
  const root = document.getElementById('root');
  if (!root) return null;
  return createPortal(<ReceiptHtml model={model} />, root);
}
