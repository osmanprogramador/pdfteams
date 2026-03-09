import React, { useState, useCallback, useRef } from 'react';
import {
  FluentProvider,
  webDarkTheme,
  Button,
  Text,
  Badge,
  Spinner,
  Tooltip,
} from '@fluentui/react-components';
import { splitPdf, getPdfPageCount } from './logic/PdfProcessor';
import './App.css';

interface PageRange {
  start: number;
  end: number;
  id: string;
}

const App: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState<number>(0);
  const [ranges, setRanges] = useState<PageRange[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = async (selectedFile: File) => {
    if (selectedFile.type !== 'application/pdf') {
      setError('Por favor, selecione um arquivo PDF válido.');
      return;
    }
    try {
      setLoadingFile(true);
      setError(null);
      setSuccess(null);
      setFile(selectedFile);
      const arrayBuffer = await selectedFile.arrayBuffer();
      const count = await getPdfPageCount(new Uint8Array(arrayBuffer));
      setPageCount(count);
      setRanges([{ start: 1, end: count, id: Date.now().toString() }]);
    } catch {
      setError('Erro ao carregar o PDF. O arquivo pode estar corrompido.');
      setFile(null);
    } finally {
      setLoadingFile(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) await processFile(selectedFile);
  };

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const selectedFile = e.dataTransfer.files?.[0];
    if (selectedFile) await processFile(selectedFile);
  }, []);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const addRange = () => {
    const lastRange = ranges[ranges.length - 1];
    const newStart = lastRange ? Math.min(lastRange.end + 1, pageCount) : 1;
    setRanges([...ranges, { start: newStart, end: pageCount, id: Date.now().toString() }]);
  };

  const removeRange = (id: string) => {
    if (ranges.length > 1) setRanges(ranges.filter(r => r.id !== id));
  };

  const updateRange = (id: string, field: 'start' | 'end', value: string) => {
    const numValue = parseInt(value) || 1;
    setRanges(ranges.map(r => {
      if (r.id !== id) return r;
      const newVal = Math.max(1, Math.min(numValue, pageCount));
      return { ...r, [field]: newVal };
    }));
  };

  const handleSplit = async () => {
    if (!file) return;
    setIsProcessing(true);
    setError(null);
    setSuccess(null);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfBytes = new Uint8Array(arrayBuffer);
      const results = await splitPdf(pdfBytes, ranges);
      results.forEach((bytes, index) => {
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const range = ranges[index];
        a.href = url;
        a.download = `${file.name.replace('.pdf', '')}_p${range.start}-${range.end}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
      setSuccess(`${results.length} arquivo(s) gerado(s) com sucesso! Verifique seus downloads.`);
    } catch {
      setError('Ocorreu um erro ao processar o PDF. Tente novamente.');
    } finally {
      setIsProcessing(false);
    }
  };

  const resetApp = () => {
    setFile(null);
    setPageCount(0);
    setRanges([]);
    setError(null);
    setSuccess(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const totalPages = ranges.reduce((sum, r) => sum + (r.end - r.start + 1), 0);

  return (
    <FluentProvider theme={webDarkTheme}>
      <div className="app-shell">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-logo">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="8" fill="#6264A7" />
              <path d="M8 8h10a6 6 0 0 1 0 12H8V8z" fill="white" opacity="0.9" />
              <path d="M12 14h10" stroke="#6264A7" strokeWidth="2" strokeLinecap="round" />
              <path d="M8 22l4-4" stroke="white" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <nav className="sidebar-nav">
            <Tooltip content="Separador de PDF" relationship="label" positioning="after">
              <button className="nav-item active">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
                  <path d="M14 2v6h6" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  <line x1="8" y1="13" x2="16" y2="13" stroke="white" strokeWidth="1.5" />
                  <line x1="8" y1="17" x2="13" y2="17" stroke="white" strokeWidth="1.5" />
                </svg>
              </button>
            </Tooltip>
          </nav>
        </aside>

        {/* Main Content */}
        <div className="main-layout">
          {/* Header */}
          <header className="app-header">
            <div className="header-left">
              <h1 className="header-title">Separador de PDF</h1>
              <span className="header-subtitle">Divida seus documentos em segundos</span>
            </div>
            {file && (
              <div className="header-right">
                <Badge appearance="tint" color="brand" size="large">
                  {pageCount} páginas
                </Badge>
                <button className="reset-btn" onClick={resetApp} title="Remover arquivo">
                  ✕ Novo arquivo
                </button>
              </div>
            )}
          </header>

          <main className="app-main">
            {/* Upload Zone */}
            {!file ? (
              <div
                className={`drop-zone ${isDragging ? 'dragging' : ''}`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  hidden
                  accept=".pdf"
                  onChange={handleFileChange}
                />
                {loadingFile ? (
                  <div className="drop-zone-content">
                    <Spinner size="large" label="Carregando PDF..." />
                  </div>
                ) : (
                  <div className="drop-zone-content">
                    <div className="drop-icon">
                      <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                        <circle cx="32" cy="32" r="32" fill="rgba(98,100,167,0.15)" />
                        <path d="M22 42h20M32 22v20M32 22l-6 6M32 22l6 6" stroke="#6264A7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <Text size={500} weight="semibold" className="drop-title">
                      Arraste seu PDF aqui
                    </Text>
                    <Text size={300} className="drop-subtitle">
                      ou clique para selecionar um arquivo
                    </Text>
                    <div className="drop-hint">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="#6264A7"><path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" /></svg>
                      <Text size={200}>Processamento 100% local — seus dados nunca saem do dispositivo</Text>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* File loaded state */
              <div className="workspace">
                {/* File info strip */}
                <div className="file-strip">
                  <div className="file-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="#6264A7">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 2v6h6" />
                    </svg>
                  </div>
                  <div className="file-info">
                    <Text weight="semibold" size={400}>{file.name}</Text>
                    <Text size={200} className="muted">
                      {(file.size / 1024).toFixed(1)} KB · {pageCount} páginas
                    </Text>
                  </div>
                </div>

                {/* Ranges section */}
                <div className="ranges-panel">
                  <div className="ranges-header">
                    <div>
                      <Text weight="semibold" size={400} block>Definir partes do PDF</Text>
                      <Text size={200} className="muted">Cada intervalo gerará um arquivo separado para download</Text>
                    </div>
                    <button className="add-btn" onClick={addRange}>
                      + Adicionar intervalo
                    </button>
                  </div>

                  <div className="ranges-list">
                    {ranges.map((range, index) => {
                      const pagesInRange = range.end - range.start + 1;
                      return (
                        <div key={range.id} className="range-card">
                          <div className="range-number">{index + 1}</div>
                          <div className="range-body">
                            <Text size={300} weight="semibold" className="range-label">
                              Parte {index + 1}
                            </Text>
                            <div className="range-controls">
                              <label className="input-group">
                                <span>Da página</span>
                                <input
                                  type="number"
                                  className="page-input"
                                  value={range.start}
                                  min={1}
                                  max={pageCount}
                                  onChange={e => updateRange(range.id, 'start', e.target.value)}
                                />
                              </label>
                              <span className="range-sep">→</span>
                              <label className="input-group">
                                <span>Até página</span>
                                <input
                                  type="number"
                                  className="page-input"
                                  value={range.end}
                                  min={1}
                                  max={pageCount}
                                  onChange={e => updateRange(range.id, 'end', e.target.value)}
                                />
                              </label>
                            </div>
                          </div>
                          <div className="range-meta">
                            <Badge appearance="filled" color="informative" size="small">
                              {pagesInRange} pág.
                            </Badge>
                            <button
                              className="remove-btn"
                              onClick={() => removeRange(range.id)}
                              disabled={ranges.length === 1}
                              title="Remover intervalo"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Summary bar */}
                  <div className="summary-bar">
                    <Text size={300} className="muted">
                      {ranges.length} arquivo(s) · {totalPages} páginas selecionadas de {pageCount}
                    </Text>
                    <Button
                      appearance="primary"
                      size="large"
                      disabled={!file || isProcessing}
                      onClick={handleSplit}
                    >
                      {isProcessing ? (
                        <>
                          <Spinner size="tiny" />
                          &nbsp;Processando...
                        </>
                      ) : (
                        `⬇ Dividir e Baixar (${ranges.length} arquivo${ranges.length > 1 ? 's' : ''})`
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Toast messages */}
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
          </main>

          {/* Footer */}
          <footer className="app-footer">
            <Text size={100} className="muted">
              Separador de PDF · Processamento local · Seus arquivos nunca saem do dispositivo
            </Text>
          </footer>
        </div>
      </div>
    </FluentProvider>
  );
};

export default App;
