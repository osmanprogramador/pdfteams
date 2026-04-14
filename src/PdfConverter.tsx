import React, { useState, useRef, useCallback } from 'react';
import { Spinner, Text, Badge } from '@fluentui/react-components';
import * as pdfjs from 'pdfjs-dist';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } from 'docx';
import * as XLSX from 'xlsx';

// Use the local worker — must match the version installed (same as SmartSplitProcessor)
pdfjs.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

type ConvertFormat = 'word' | 'excel';

interface PageContent {
    pageNum: number;
    lines: string[];
}

/* ─── Text extraction (pdfjs) ─── */
async function extractAllPages(
    file: File,
    onProgress?: (current: number, total: number) => void
): Promise<PageContent[]> {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    const total = pdf.numPages;
    const pages: PageContent[] = [];

    for (let i = 1; i <= total; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();

        const itemsByY = new Map<number, { x: number; text: string }[]>();
        for (const item of textContent.items) {
            if ('str' in item && item.str.trim() !== '') {
                const yKey = Math.round((item as { transform: number[] }).transform[5] / 2) * 2;
                if (!itemsByY.has(yKey)) itemsByY.set(yKey, []);
                itemsByY.get(yKey)!.push({
                    x: Math.round((item as { transform: number[] }).transform[4]),
                    text: item.str,
                });
            }
        }

        const sortedLines = [...itemsByY.entries()]
            .sort(([a], [b]) => b - a)
            .map(([, items]) =>
                items.sort((a, b) => a.x - b.x).map(i => i.text).join(' ').replace(/\s{2,}/g, ' ').trim()
            )
            .filter(l => l.length > 0);

        pages.push({ pageNum: i, lines: sortedLines });
        onProgress?.(i, total);
    }

    return pages;
}

/* ─── Word conversion ─── */
async function convertToWord(pages: PageContent[], filename: string): Promise<void> {
    const sections = pages.flatMap((page, idx) => {
        const children: Paragraph[] = [];

        if (idx > 0) {
            // Page break between pages
            children.push(
                new Paragraph({
                    pageBreakBefore: true,
                    heading: HeadingLevel.HEADING_2,
                    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '2E74B5' } },
                    children: [new TextRun({ text: `Página ${page.pageNum}`, bold: true, color: '2E74B5', size: 22 })],
                })
            );
        } else {
            children.push(
                new Paragraph({
                    heading: HeadingLevel.HEADING_2,
                    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '2E74B5' } },
                    children: [new TextRun({ text: `Página ${page.pageNum}`, bold: true, color: '2E74B5', size: 22 })],
                })
            );
        }

        for (const line of page.lines) {
            children.push(
                new Paragraph({
                    alignment: AlignmentType.JUSTIFIED,
                    children: [new TextRun({ text: line, size: 22, font: 'Calibri' })],
                    spacing: { after: 80 },
                })
            );
        }

        return children;
    });

    const doc = new Document({
        creator: 'PDF Converter - GEI MRD',
        title: filename,
        description: 'Convertido de PDF via PDF Converter',
        styles: {
            default: {
                document: {
                    run: { font: 'Calibri', size: 22 },
                },
            },
        },
        sections: [{ children: sections }],
    });

    const blob = await Packer.toBlob(doc);
    await triggerDownload(blob, `${stripExt(filename)}.docx`);
}

/* ─── Excel conversion ─── */
async function convertToExcel(pages: PageContent[], filename: string): Promise<void> {
    const wb = XLSX.utils.book_new();

    for (const page of pages) {
        const wsData: string[][] = [];
        wsData.push([`Página ${page.pageNum}`]);
        wsData.push(['']);
        for (const line of page.lines) {
            wsData.push([line]);
        }

        const ws = XLSX.utils.aoa_to_sheet(wsData);
        const maxLen = Math.max(...wsData.map(r => (r[0] || '').length), 10);
        ws['!cols'] = [{ wch: Math.min(maxLen, 120) }];

        const sheetName = `Pág ${page.pageNum}`.substring(0, 31);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    // Use write() to get raw bytes instead of writeFile() to control filename
    const wbOut: ArrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await triggerDownload(blob, `${stripExt(filename)}.xlsx`);
}

/* ─── Helpers ─── */
function stripExt(name: string): string {
    return name.replace(/\.[^/.]+$/, '');
}

async function triggerDownload(blob: Blob, name: string): Promise<void> {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const isDocx = ext === 'docx';

    // Primary: File System Access API (native Save As dialog — works in all contexts including Teams)
    if ('showSaveFilePicker' in window) {
        try {
            const mimeTypes = isDocx
                ? { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] as const }
                : { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] as const };
            const handle = await (window as Window & { showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
                suggestedName: name,
                types: [{ description: isDocx ? 'Documento Word' : 'Planilha Excel', accept: mimeTypes }],
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            return;
        } catch (e) {
            // AbortError = user cancelled — treat as success (no download)
            if (e instanceof Error && e.name === 'AbortError') return;
            // Other errors: fall through to fallback
        }
    }

    // Fallback: blob URL (works in standard browsers outside Teams)
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.cssText = 'position:fixed;top:-100px;opacity:0;';
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
}

/* ─── Component ─── */
const PdfConverter: React.FC = () => {
    const [file, setFile] = useState<File | null>(null);
    const [format, setFormat] = useState<ConvertFormat>('word');
    const [isDragging, setIsDragging] = useState(false);
    const [isConverting, setIsConverting] = useState(false);
    const [progressLabel, setProgressLabel] = useState('');
    const [progressPct, setProgressPct] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFile = (f: File) => {
        if (f.type !== 'application/pdf') {
            setError('Por favor, selecione um arquivo PDF válido.');
            return;
        }
        setFile(f);
        setError(null);
        setSuccess(null);
    };

    const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) handleFile(f);
    }, []);

    const handleConvert = async () => {
        if (!file) return;
        setIsConverting(true);
        setProgressPct(0);
        setError(null);
        setSuccess(null);
        try {
            setProgressLabel('Extraindo texto do PDF...');
            const pages = await extractAllPages(file, (cur, tot) => {
                setProgressLabel(`Extraindo página ${cur} de ${tot}...`);
                setProgressPct(Math.round((cur / tot) * 70)); // extraction = 0-70%
            });
            const totalLines = pages.reduce((s, p) => s + p.lines.length, 0);

            if (totalLines === 0) {
                setError('Nenhum texto encontrado no PDF. Este arquivo pode ser uma imagem escaneada e não pode ser convertido automaticamente.');
                return;
            }

            setProgressPct(80);
            setProgressLabel(format === 'word' ? 'Gerando documento Word...' : 'Gerando planilha Excel...');

            if (format === 'word') {
                await convertToWord(pages, file.name);
                setSuccess(`Arquivo Word gerado! ${pages.length} página(s) · ${totalLines} linhas extraídas.`);
            } else {
                await convertToExcel(pages, file.name);
                setSuccess(`Planilha Excel gerada! ${pages.length} aba(s) · ${totalLines} linhas extraídas.`);
            }
            setProgressPct(100);
        } catch (e) {
            console.error(e);
            setError('Erro ao converter o arquivo. Verifique se o PDF não está protegido por senha.');
        } finally {
            setIsConverting(false);
            setTimeout(() => setProgressPct(0), 800);
        }
    };

    return (
        <div className="converter-panel">
            {/* Title */}
            <div className="converter-header">
                <Text weight="semibold" size={500} block>Converter PDF</Text>
                <Text size={200} className="muted" block>
                    Extraia texto do PDF e gere um arquivo editável
                </Text>
            </div>

            {/* Info box */}
            <div className="converter-info-box">
                <div className="info-row">
                    <span className="info-icon">💡</span>
                    <div>
                        <Text size={300} weight="semibold" block>Para melhores resultados:</Text>
                        <ul className="info-list">
                            <li><strong>PDF → Word:</strong> Use PDFs gerados a partir do Word (.docx). Preserva parágrafos e estrutura de páginas.</li>
                            <li><strong>PDF → Excel:</strong> Use PDFs gerados a partir do Excel (.xlsx), como relatórios e tabelas. Cada página vira uma aba.</li>
                            <li><strong>PDFs escaneados</strong> (fotos de documentos) <strong>não possuem texto digital</strong> e não podem ser convertidos.</li>
                        </ul>
                    </div>
                </div>
                <div className="info-divider" />
                <div className="info-row">
                    <span className="info-icon">📏</span>
                    <div>
                        <Text size={300} weight="semibold" block>Tamanho do PDF:</Text>
                        <ul className="info-list">
                            <li><strong>Até 10 MB</strong> — ✅ conversão rápida (1–5 segundos)</li>
                            <li><strong>10 MB – 50 MB</strong> — ⚠️ pode demorar 10–30 segundos</li>
                            <li><strong>Acima de 50 MB</strong> — ⛔ não recomendado (pode travar o browser)</li>
                        </ul>
                        <Text size={100} className="muted" block style={{ marginTop: 4 }}>O processamento é 100% local — arquivos maiores exigem mais memória RAM do browser.</Text>
                    </div>
                </div>
            </div>

            {/* Format selector */}
            <div className="converter-format-selector">
                <Text size={300} weight="semibold" block style={{ marginBottom: 8 }}>Formato de saída:</Text>
                <div className="format-cards">
                    <button
                        className={`format-card ${format === 'word' ? 'active' : ''}`}
                        onClick={() => setFormat('word')}
                    >
                        <span className="format-icon">📝</span>
                        <div>
                            <Text size={300} weight="semibold" block>Word (.docx)</Text>
                            <Text size={200} className="muted" block>Texto com formatação de página</Text>
                        </div>
                    </button>
                    <button
                        className={`format-card ${format === 'excel' ? 'active' : ''}`}
                        onClick={() => setFormat('excel')}
                    >
                        <span className="format-icon">📊</span>
                        <div>
                            <Text size={300} weight="semibold" block>Excel (.xlsx)</Text>
                            <Text size={200} className="muted" block>Uma aba por página do PDF</Text>
                        </div>
                    </button>
                </div>
            </div>

            {/* Drop zone */}
            <div
                className={`drop-zone converter-drop ${isDragging ? 'dragging' : ''}`}
                onDrop={handleDrop}
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onClick={() => fileInputRef.current?.click()}
            >
                <input ref={fileInputRef} type="file" hidden accept=".pdf" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                {file ? (
                    <div className="converter-file-selected">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="#AFD9F5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 2v6h6" /></svg>
                        <div>
                            <Text weight="semibold" size={300} block>{file.name}</Text>
                            <Text size={200} className="muted">{(file.size / 1024).toFixed(1)} KB</Text>
                        </div>
                        <button className="remove-btn" onClick={e => { e.stopPropagation(); setFile(null); setSuccess(null); setError(null); }} title="Remover">✕</button>
                    </div>
                ) : (
                    <div className="drop-zone-content">
                        <div className="drop-icon">
                            <svg width="48" height="48" viewBox="0 0 64 64" fill="none">
                                <circle cx="32" cy="32" r="32" fill="rgba(175,217,245,0.08)" />
                                <path d="M22 42h20M32 22v20M32 22l-6 6M32 22l6 6" stroke="#AFD9F5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </div>
                        <Text size={400} weight="semibold" className="drop-title">Arraste seu PDF aqui</Text>
                        <Text size={200} className="drop-subtitle">ou clique para selecionar</Text>
                    </div>
                )}
            </div>

            {/* Convert button + progress */}
            <button
                className="convert-btn"
                disabled={!file || isConverting}
                onClick={handleConvert}
            >
                {isConverting ? (
                    <><Spinner size="tiny" />&nbsp;{progressLabel || 'Convertendo...'}</>
                ) : (
                    <>⬇ Converter para {format === 'word' ? 'Word (.docx)' : 'Excel (.xlsx)'}</>
                )}
            </button>
            {isConverting && progressPct > 0 && (
                <div className="converter-progress">
                    <div className="converter-progress-bar" style={{ width: `${progressPct}%` }} />
                    <span className="converter-progress-label">{progressPct}%</span>
                </div>
            )}

            {/* Info badge */}
            <div className="converter-privacy">
                <Badge appearance="outline" color="informative" size="small">🔒 100% local</Badge>
                <Text size={100} className="muted">&nbsp;Seus arquivos nunca saem do dispositivo</Text>
            </div>

            {/* Toasts */}
            {error && (
                <div className="toast toast-error">
                    <span>⚠ {error}</span>
                    <button onClick={() => setError(null)}>✕</button>
                </div>
            )}
            {success && (
                <div className="toast toast-success">
                    <span>✓ {success}</span>
                    <button onClick={() => setSuccess(null)}>✕</button>
                </div>
            )}
        </div>
    );
};

export default PdfConverter;
