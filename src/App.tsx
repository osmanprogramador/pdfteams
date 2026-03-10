import React, { useState, useCallback, useRef, useEffect } from 'react';
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
import type { SmartSplitConfig, SmartSplitResult } from './logic/SmartSplitProcessor';
import {
  defaultConfig,
  loadConfig,
  saveConfig,
  previewSmartSplit,
} from './logic/SmartSplitProcessor';
import './App.css';

interface PageRange {
  start: number;
  end: number;
  id: string;
}

type AppMode = 'manual' | 'smart';

const App: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState<number>(0);
  const [ranges, setRanges] = useState<PageRange[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [appMode, setAppMode] = useState<AppMode>('manual');
  const [smartConfig, setSmartConfig] = useState<SmartSplitConfig>(loadConfig());
  const [smartPreview, setSmartPreview] = useState<SmartSplitResult[] | null>(null);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [loadingPreview, setLoadingPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    saveConfig(smartConfig);
  }, [smartConfig]);

  const processFile = async (selectedFile: File) => {
    if (selectedFile.type !== 'application/pdf') {
      setError('Por favor, selecione um arquivo PDF válido.');
      return;
    }
    try {
      setLoadingFile(true);
      setError(null);
      setSuccess(null);
      setSmartPreview(null);
      setSelectedPages(new Set());
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

  /* ──────── Manual split helpers ──────── */
  const addRange = () => {
    const lastRange = ranges[ranges.length - 1];
    const newStart = lastRange ? Math.min(lastRange.end + 1, pageCount) : 1;
    setRanges([...ranges, { start: newStart, end: pageCount, id: Date.now().toString() }]);
  };

  const splitAllPages = () => {
    const allRanges: PageRange[] = [];
    for (let i = 1; i <= pageCount; i++) {
      allRanges.push({ start: i, end: i, id: (Date.now() + i).toString() });
    }
    setRanges(allRanges);
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

  /* ──────── Smart split helpers ──────── */
  const handleGeneratePreview = async () => {
    if (!file) return;
    setLoadingPreview(true);
    setError(null);
    setSmartPreview(null);
    setSelectedPages(new Set());
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfBytes = new Uint8Array(arrayBuffer);
      const preview = await previewSmartSplit(pdfBytes, smartConfig);
      setSmartPreview(preview);
      // Initialize selectedPages with all pages
      setSelectedPages(new Set(preview.map(p => p.pagina)));
    } catch (e) {
      setError('Erro ao extrair texto do PDF. Verifique se o arquivo tem camada de texto.');
      console.error(e);
    } finally {
      setLoadingPreview(false);
    }
  };

  const togglePageSelection = (page: number) => {
    const nextSelection = new Set(selectedPages);
    if (nextSelection.has(page)) {
      nextSelection.delete(page);
    } else {
      nextSelection.add(page);
    }
    setSelectedPages(nextSelection);
  };

  const toggleAllPages = () => {
    if (!smartPreview) return;
    if (selectedPages.size === smartPreview.length) {
      setSelectedPages(new Set());
    } else {
      setSelectedPages(new Set(smartPreview.map(p => p.pagina)));
    }
  };

  const handleSmartSplit = async () => {
    if (!file || !smartPreview || selectedPages.size === 0) return;
    setIsProcessing(true);
    setError(null);
    setSuccess(null);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfBytes = new Uint8Array(arrayBuffer);

      // Filter smartPreview based on selectedPages
      const activeResults = smartPreview.filter(p => selectedPages.has(p.pagina));

      const pageRanges: PageRange[] = activeResults.map((p) => ({
        start: p.pagina,
        end: p.pagina,
        id: (Date.now() + p.pagina).toString(),
      }));

      const results = await splitPdf(pdfBytes, pageRanges);
      results.forEach((bytes, index) => {
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = activeResults[index].nomeArquivo;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
      setSuccess(`${results.length} arquivo(s) baixado(s) com nomes automáticos!`);
    } catch {
      setError('Erro ao processar o PDF.');
    } finally {
      setIsProcessing(false);
    }
  };

  const updateConfig = (field: keyof SmartSplitConfig, value: string) => {
    setSmartConfig(prev => ({ ...prev, [field]: value }));
    setSmartPreview(null); // invalidate preview when config changes
    setSelectedPages(new Set());
  };

  const resetApp = () => {
    setFile(null);
    setPageCount(0);
    setRanges([]);
    setError(null);
    setSuccess(null);
    setSmartPreview(null);
    setSelectedPages(new Set());
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const totalPages = ranges.reduce((sum, r) => sum + (r.end - r.start + 1), 0);

  return (
    <FluentProvider theme={webDarkTheme}>
      <div className="app-shell">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-logo">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" fill="#AFD9F5" opacity="0.9" />
              <path d="M14 2v6h6" stroke="#AFD9F5" strokeWidth="1.5" fill="none" />
              <line x1="8" y1="13" x2="16" y2="13" stroke="#1B284E" strokeWidth="1.5" />
              <line x1="8" y1="17" x2="13" y2="17" stroke="#1B284E" strokeWidth="1.5" />
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
              <img
                src={`${import.meta.env.BASE_URL}Logo-Branca.png`}
                alt="Logo"
                className="header-logo"
              />
              <h1 className="header-title">Separador de PDF</h1>
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
                        <circle cx="32" cy="32" r="32" fill="rgba(175,217,245,0.1)" />
                        <path d="M22 42h20M32 22v20M32 22l-6 6M32 22l6 6" stroke="#AFD9F5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <Text size={500} weight="semibold" className="drop-title">
                      Arraste seu PDF aqui
                    </Text>
                    <Text size={300} className="drop-subtitle">
                      ou clique para selecionar um arquivo
                    </Text>
                    <div className="drop-hint">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="#AFD9F5"><path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" /></svg>
                      <Text size={200}>Processamento 100% local — seus dados nunca saem do dispositivo</Text>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="workspace">
                {/* File info strip */}
                <div className="file-strip">
                  <div className="file-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="#AFD9F5">
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

                {/* Mode Toggle */}
                <div className="mode-toggle">
                  <button
                    className={`mode-btn ${appMode === 'manual' ? 'active' : ''}`}
                    onClick={() => setAppMode('manual')}
                  >
                    Manual
                  </button>
                  <button
                    className={`mode-btn ${appMode === 'smart' ? 'active' : ''}`}
                    onClick={() => setAppMode('smart')}
                  >
                    Inteligente
                  </button>
                </div>

                {/* ═══ MANUAL MODE ═══ */}
                {appMode === 'manual' && (
                  <div className="ranges-panel">
                    <div className="ranges-header">
                      <div>
                        <Text weight="semibold" size={400} block>Definir partes do PDF</Text>
                        <Text size={200} className="muted">Cada intervalo gerará um arquivo separado para download</Text>
                      </div>
                      <div className="ranges-header-actions">
                        <button className="split-all-btn" onClick={splitAllPages} title={`Criar ${pageCount} intervalos, um por página`}>
                          Página por página
                        </button>
                        <button className="add-btn" onClick={addRange}>
                          + Adicionar intervalo
                        </button>
                      </div>
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
                          <><Spinner size="tiny" />&nbsp;Processando...</>
                        ) : (
                          `⬇ Dividir e Baixar (${ranges.length} arquivo${ranges.length > 1 ? 's' : ''})`
                        )}
                      </Button>
                    </div>
                  </div>
                )}

                {/* ═══ SMART MODE ═══ */}
                {appMode === 'smart' && (
                  <div className="smart-panel">
                    {/* Config section */}
                    <div className="smart-config">
                      <Text weight="semibold" size={400} block>Configuração de Nomenclatura</Text>
                      <div className="smart-preview-filename">
                        <Text size={200} className="muted" block>
                          Amostra do nome gerado:
                        </Text>
                        <span className="filename-preview">
                          {[
                            '202602',
                            smartConfig.empresa,
                            smartConfig.projeto,
                            'DEPTO',
                            smartConfig.equipe,
                            smartConfig.tipoDoc,
                            'NOMECOLABORADOR',
                          ].filter(Boolean).map(s => s.toUpperCase()).join('_')}.pdf
                        </span>
                      </div>

                      <div className="config-grid">
                        <div className="config-section">
                          <Text size={300} weight="semibold" block className="config-section-title">
                            Prefixos fixos (configuráveis)
                          </Text>
                          <div className="config-fields">
                            {([
                              { field: 'empresa', label: 'Empresa', placeholder: 'AEDAS' },
                              { field: 'projeto', label: 'Projeto', placeholder: 'MRD' },
                              { field: 'equipe', label: 'Equipe', placeholder: 'ADM' },
                              { field: 'tipoDoc', label: 'Tipo de Documento', placeholder: 'DEMONSTRATIVOS' },
                            ] as { field: Exclude<keyof SmartSplitConfig, 'mapeamentoDepto'>; label: string; placeholder: string }[]).map(({ field, label, placeholder }) => (
                              <label key={field} className="config-field">
                                <span className="config-label">{label}</span>
                                <input
                                  type="text"
                                  className="config-input"
                                  value={smartConfig[field]}
                                  placeholder={placeholder}
                                  onChange={e => updateConfig(field, e.target.value)}
                                />
                              </label>
                            ))}
                          </div>
                        </div>

                        <div className="config-section">
                          <Text size={300} weight="semibold" block className="config-section-title">
                            Rótulos extraídos do PDF
                          </Text>
                          <div className="config-fields">
                            <label className="config-field">
                              <span className="config-label">Rótulo do nome</span>
                              <input
                                type="text"
                                className="config-input"
                                value={smartConfig.rotuloNome}
                                placeholder="Func.:"
                                onChange={e => updateConfig('rotuloNome', e.target.value)}
                              />
                            </label>
                            <label className="config-field">
                              <span className="config-label">Rótulo do período</span>
                              <input
                                type="text"
                                className="config-input"
                                value={smartConfig.rotuloPeriodo}
                                placeholder="Período:"
                                onChange={e => updateConfig('rotuloPeriodo', e.target.value)}
                              />
                            </label>
                            <label className="config-field">
                              <span className="config-label">Rótulo do departamento</span>
                              <input
                                type="text"
                                className="config-input"
                                value={smartConfig.rotuloDepto}
                                placeholder="Depto.:"
                                onChange={e => updateConfig('rotuloDepto', e.target.value)}
                              />
                            </label>
                            <button
                              className="reset-config-btn"
                              onClick={() => { setSmartConfig({ ...defaultConfig }); setSmartPreview(null); }}
                            >
                              ↺ Restaurar padrões
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* NOVO: Gerenciamento de Mapeamento de Departamentos */}
                      <div className="config-section mapping-section">
                        <Text size={300} weight="semibold" block className="config-section-title">
                          Abreviações de Departamentos
                        </Text>
                        <div className="mapping-list">
                          {Object.entries(smartConfig.mapeamentoDepto).map(([pdfText, abbreviation]) => (
                            <div key={pdfText} className="mapping-item">
                              <span className="mapping-text">
                                <strong>{pdfText}</strong> → {abbreviation}
                              </span>
                              <button
                                className="remove-mapping-btn"
                                onClick={() => {
                                  const newMap = { ...smartConfig.mapeamentoDepto };
                                  delete newMap[pdfText];
                                  setSmartConfig(prev => ({ ...prev, mapeamentoDepto: newMap }));
                                  setSmartPreview(null);
                                  setSelectedPages(new Set());
                                }}
                                title="Remover mapeamento"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                        <div className="add-mapping-form">
                          <input
                            type="text"
                            id="new-depto-pdf"
                            placeholder="Texto lido no PDF (ex: PROJETO AIMORES)"
                            className="config-input mapping-input"
                          />
                          <input
                            type="text"
                            id="new-depto-abrev"
                            placeholder="Abreviação (ex: AIM)"
                            className="config-input mapping-input abrev-input"
                          />
                          <button
                            className="add-mapping-btn"
                            onClick={() => {
                              const pdfInput = document.getElementById('new-depto-pdf') as HTMLInputElement;
                              const abrevInput = document.getElementById('new-depto-abrev') as HTMLInputElement;
                              if (pdfInput.value && abrevInput.value) {
                                const newMap = {
                                  ...smartConfig.mapeamentoDepto,
                                  [pdfInput.value.toUpperCase()]: abrevInput.value.toUpperCase()
                                };
                                setSmartConfig(prev => ({ ...prev, mapeamentoDepto: newMap }));
                                setSmartPreview(null);
                                setSelectedPages(new Set());
                                pdfInput.value = '';
                                abrevInput.value = '';
                              }
                            }}
                          >
                            + Adicionar
                          </button>
                        </div>
                      </div>

                      <button
                        className="preview-btn"
                        onClick={handleGeneratePreview}
                        disabled={loadingPreview}
                      >
                        {loadingPreview ? '⏳ Analisando PDF...' : '🔍 Analisar e Pré-visualizar nomes'}
                      </button>
                    </div>

                    {/* Preview table */}
                    {smartPreview && (
                      <div className="preview-panel">
                        <div className="preview-header">
                          <div className="preview-header-info">
                            <Text weight="semibold" size={400} block>Páginas Detectadas ({selectedPages.size} selecionadas)</Text>
                            <Text size={200} className="muted" block>
                              {smartPreview.filter(r => r.encontrado).length} de {smartPreview.length} com dados identificados
                            </Text>
                          </div>
                          <div className="preview-header-right">
                            <Button
                              size="small"
                              appearance="subtle"
                              onClick={() => {
                                const text = smartPreview.map(p => `PÁGINA ${p.pagina}:\n${p.rawText}`).join('\n\n---\n\n');
                                alert("COPIE O TEXTO ABAIXO E ME ENVIE:\n\n" + text.substring(0, 2000) + (text.length > 2000 ? "..." : ""));
                                console.log("TEXTO BRUTO COMPLETO:", text);
                              }}
                            >
                              🔍 Ver Texto Bruto
                            </Button>
                            <Badge appearance="filled" color={selectedPages.size > 0 ? 'success' : 'important'}>
                              {selectedPages.size} de {smartPreview.length} páginas
                            </Badge>
                          </div>
                        </div>
                        <div className="preview-table-wrap">
                          <table className="preview-table">
                            <thead>
                              <tr>
                                <th className="checkbox-col">
                                  <input
                                    type="checkbox"
                                    className="custom-checkbox"
                                    checked={selectedPages.size === smartPreview.length && smartPreview.length > 0}
                                    onChange={toggleAllPages}
                                  />
                                </th>
                                <th className="page-col">Pág.</th>
                                <th>Colaborador</th>
                                <th>Período</th>
                                <th>Depto</th>
                                <th>Nome do arquivo final</th>
                              </tr>
                            </thead>
                            <tbody>
                              {smartPreview.map(row => (
                                <tr key={row.pagina} className={row.encontrado ? '' : 'row-warning'}>
                                  <td className="checkbox-col">
                                    <input
                                      type="checkbox"
                                      className="custom-checkbox"
                                      checked={selectedPages.has(row.pagina)}
                                      onChange={() => togglePageSelection(row.pagina)}
                                    />
                                  </td>
                                  <td className="page-col">{row.pagina}</td>
                                  <td>{row.nomeColaborador || <span className="not-found">Não encontrado</span>}</td>
                                  <td>{row.periodo || <span className="not-found">—</span>}</td>
                                  <td>{row.depto || <span className="not-found">—</span>}</td>
                                  <td className="filename-cell">{row.nomeArquivo}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <div className="summary-bar">
                          <Text size={300} className="muted">
                            {selectedPages.size} arquivo(s) serão gerados
                          </Text>
                          <Button
                            appearance="primary"
                            size="large"
                            disabled={isProcessing || selectedPages.size === 0}
                            onClick={handleSmartSplit}
                          >
                            {isProcessing ? (
                              <><Spinner size="tiny" />&nbsp;Processando...</>
                            ) : (
                              `⬇ Separar e Renomear (${selectedPages.size} arquivo${selectedPages.size > 1 ? 's' : ''})`
                            )}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
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
            <Text size={100} className="muted" block>
              Separador de PDF · Processamento local · Seus arquivos nunca saem do dispositivo
            </Text>
            <Text size={100} className="muted" block>
              Desenvolvido pela GEI MRD. Todos os direitos reservados.
            </Text>
          </footer>
        </div>
      </div>
    </FluentProvider>
  );
};

export default App;
