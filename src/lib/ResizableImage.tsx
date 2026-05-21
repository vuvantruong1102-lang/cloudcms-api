// ResizableImage - Tiptap node custom
// - Kéo handle 2 bên để resize
// - Toolbar nổi: căn trái/giữa/phải, nhập width, xóa
// - Caption tự sinh từ alt text
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useRef, useState, useCallback } from 'react';
import { AlignLeft, AlignCenter, AlignRight, X } from 'lucide-react';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    resizableImage: {
      setResizableImage: (options: {
        src: string;
        alt?: string;
        width?: number | null;
        align?: 'left' | 'center' | 'right';
      }) => ReturnType;
    };
  }
}

export const ResizableImage = Node.create({
  name: 'resizableImage',
  group: 'block',
  draggable: true,
  selectable: true,
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      width: { default: null }, // px hoặc null = auto
      align: { default: 'center' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure[data-resizable-image]',
        getAttrs: (el) => {
          const elt = el as HTMLElement;
          const img = elt.querySelector('img');
          return {
            src: img?.getAttribute('src') ?? null,
            alt: img?.getAttribute('alt') ?? null,
            width: img?.getAttribute('width') ? parseInt(img.getAttribute('width')!) : null,
            align: elt.dataset.align || 'center',
          };
        },
      },
      // Fallback parse <img> thường (cho bài cũ)
      {
        tag: 'img[src]',
        getAttrs: (el) => ({
          src: (el as HTMLElement).getAttribute('src'),
          alt: (el as HTMLElement).getAttribute('alt'),
          width: (el as HTMLElement).getAttribute('width')
            ? parseInt((el as HTMLElement).getAttribute('width')!)
            : null,
          align: 'center',
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { src, alt, width, align } = HTMLAttributes;
    const figureAttrs: any = {
      'data-resizable-image': '',
      'data-align': align || 'center',
      class: `resizable-image-figure align-${align || 'center'}`,
    };
    const imgAttrs: any = { src, alt: alt || '', loading: 'lazy' };
    if (width) imgAttrs.width = width;
    const out: any = ['figure', mergeAttributes(figureAttrs), ['img', imgAttrs]];
    if (alt) out.push(['figcaption', {}, alt]);
    return out;
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },

  addCommands() {
    return {
      setResizableImage:
        (options) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: options }),
    };
  },
});

// React component cho NodeView
function ResizableImageView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const { src, alt, width, align } = node.attrs as {
    src: string;
    alt: string | null;
    width: number | null;
    align: 'left' | 'center' | 'right';
  };
  const imgRef = useRef<HTMLImageElement>(null);

  const onResizeStart = useCallback(
    (e: React.MouseEvent, dir: 'left' | 'right') => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = imgRef.current?.offsetWidth ?? 0;

      const onMove = (moveEvt: MouseEvent) => {
        const delta = dir === 'right' ? moveEvt.clientX - startX : startX - moveEvt.clientX;
        const newWidth = Math.max(100, Math.min(1200, startWidth + delta));
        if (imgRef.current) imgRef.current.style.width = `${newWidth}px`;
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const finalW = imgRef.current?.offsetWidth ?? startWidth;
        updateAttributes({ width: finalW });
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [updateAttributes]
  );

  return (
    <NodeViewWrapper
      className={`resizable-image-wrapper align-${align} ${selected ? 'is-selected' : ''}`}
    >
      <figure className="resizable-image-figure" style={{ textAlign: align }}>
        <div
          className="resizable-image-container"
          style={{ display: 'inline-block', position: 'relative', maxWidth: '100%' }}
        >
          <img
            ref={imgRef}
            src={src}
            alt={alt || ''}
            style={{
              width: width ? `${width}px` : 'auto',
              maxWidth: '100%',
              height: 'auto',
              display: 'block',
              borderRadius: 8,
            }}
            draggable={false}
          />
          {selected && (
            <>
              <div onMouseDown={(e) => onResizeStart(e, 'left')} style={handleStyle('left')} title="Kéo để thay đổi kích thước" />
              <div onMouseDown={(e) => onResizeStart(e, 'right')} style={handleStyle('right')} title="Kéo để thay đổi kích thước" />

              <div className="resizable-image-toolbar">
                <button type="button" onClick={() => updateAttributes({ align: 'left' })} className={align === 'left' ? 'active' : ''} title="Căn trái">
                  <AlignLeft className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => updateAttributes({ align: 'center' })} className={align === 'center' ? 'active' : ''} title="Căn giữa">
                  <AlignCenter className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => updateAttributes({ align: 'right' })} className={align === 'right' ? 'active' : ''} title="Căn phải">
                  <AlignRight className="w-3.5 h-3.5" />
                </button>
                <span className="separator" />
                <input
                  type="number"
                  value={width || ''}
                  onChange={(e) => updateAttributes({ width: parseInt(e.target.value) || null })}
                  placeholder="Auto"
                  style={{
                    width: 60,
                    fontSize: 11,
                    padding: '2px 4px',
                    border: '1px solid #d1d5db',
                    borderRadius: 4,
                  }}
                  title="Width (px) — để trống = auto"
                />
                <span className="separator" />
                <button type="button" onClick={() => deleteNode()} title="Xóa ảnh" style={{ color: '#dc2626' }}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </>
          )}
        </div>
        {alt && <figcaption className="resizable-image-caption">{alt}</figcaption>}
      </figure>
    </NodeViewWrapper>
  );
}

function handleStyle(side: 'left' | 'right'): React.CSSProperties {
  return {
    position: 'absolute',
    top: '50%',
    [side]: -6,
    transform: 'translateY(-50%)',
    width: 12,
    height: 40,
    borderRadius: 3,
    background: '#3b82f6',
    border: '2px solid white',
    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
    cursor: 'ew-resize',
    zIndex: 10,
  };
}
