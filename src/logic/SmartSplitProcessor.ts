import * as pdfjsLib from 'pdfjs-dist';

// Use o worker do próprio pdfjs-dist para garantir compatibilidade
pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

export interface SmartSplitConfig {
    empresa: string;
    projeto: string;
    equipe: string;
    tipoDoc: string;
    rotuloNome: string;
    rotuloPeriodo: string;
    rotuloDepto: string;
    mapeamentoDepto: Record<string, string>;
}

export interface SmartSplitResult {
    nomeArquivo: string;
    pagina: number;
    nomeColaborador: string;
    periodo: string;
    depto: string;
    encontrado: boolean;
    rawText?: string;
}

export const CONFIG_KEY = 'smartSplitConfig';

export const defaultConfig: SmartSplitConfig = {
    empresa: 'AEDAS',
    projeto: 'MRD',
    equipe: 'ADM',
    tipoDoc: 'DEMONSTRATIVOS',
    rotuloNome: 'Func.:',
    rotuloPeriodo: 'Período:',
    rotuloDepto: 'Depto.:',
    mapeamentoDepto: {
        'PROJETO CONSELHEIRO PENA': 'CON_PEN',
        'PROJETO AIMORES': 'AIMORES',
        'PROJETO VALE DO ACO': 'VA',
        'PROJETO ITUETA E RESPLENDOR': 'ITU_RESP',
    },
};

export function loadConfig(): SmartSplitConfig {
    try {
        const saved = localStorage.getItem(CONFIG_KEY);
        if (saved) return { ...defaultConfig, ...JSON.parse(saved) };
    } catch { /* ignore */ }
    return { ...defaultConfig };
}

export function saveConfig(config: SmartSplitConfig) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

async function extractRawPagesText(pdfBytes: Uint8Array): Promise<string[]> {
    const doc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();

        // Ordena itens por posição: Y descendente (topo para baixo), X ascendente (esquerda para direita)
        const sortedItems = content.items.sort((a: any, b: any) => {
            // No PDF.js, a posição vertical (transform[5]) geralmente aumenta de baixo para cima.
            // Para leitura humana, queremos do topo para baixo.
            const yDiff = b.transform[5] - a.transform[5];
            if (Math.abs(yDiff) > 5) return yDiff; // Diferença significativa de linha
            return a.transform[4] - b.transform[4]; // Mesma linha, ordena por X
        });

        const text = sortedItems.map((item: any) => item.str || '').join('  ');
        pages.push(text);
    }
    return pages;
}

function normalizarParaBusca(texto: string): string {
    return texto
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/[^\x20-\x7E\s]/g, '') // Remove caracteres não imprimíveis residuais
        .toUpperCase()
        .trim();
}

function escaparParaRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function simplificar(str: string): string {
    return str.replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

/**
 * Extração de campo via RegEx robusta e Fuzzy Matching.
 */
function extrairCampo(texto: string, rotulo: string): string {
    if (!rotulo) return '';
    const textoNorm = normalizarParaBusca(texto);
    const rotNorm = normalizarParaBusca(rotulo);

    // 1. Tenta RegEx padrão (especialmente eficaz com a nova ordenação visual)
    const rBase = rotNorm.replace(/[:.]$/, '');
    const escaped = escaparParaRegex(rBase) + '[.:]?\\s*[:]?';

    // Delimitadores: Palavra capitalizada + :, data, múltiplos espaços, ou final de linha
    const regex1 = new RegExp(escaped + '\\s*([^:]{2,100}?)(\\s{3,}|\\s+[A-Z][a-zA-Z]{2,15}\\s*[:]|\\s*\\d{2}[/.-]\\d{4}|$)', 'i');

    const tentarRegex = (re: RegExp): string | null => {
        const match = textoNorm.match(re);
        if (match) {
            let val = match[1].trim();
            // Remove códigos iniciais (ex: "000025 - ")
            val = val.replace(/^[\d.-]+\s*[-/]\s*/, '').trim();
            val = val.replace(/^[:.-]+\s*/, '').trim();
            val = val.replace(/\s+/g, ' '); // Normaliza espaços internos

            if (val && val.length > 2 && !val.endsWith(':')) return val;
        }
        return null;
    };

    const resReg = tentarRegex(regex1);
    if (resReg) return resReg;

    // 2. Fuzzy Match: Ignora espaços no rótulo (útil se o PDF tiver espaçamento entre letras)
    const textoSimples = simplificar(textoNorm);
    const rotSimples = simplificar(rotNorm);
    const posSimples = textoSimples.indexOf(rotSimples);

    if (posSimples !== -1) {
        const rFuzzy = rotSimples.split('').join('\\s*[^A-Z0-9]{0,3}\\s*');
        const reFuzzy = new RegExp(rFuzzy + '[.:]?\\s*[:]?\\s*([^:]{2,100}?)(\\s{3,}|[A-Z][a-z]+:|$)', 'i');
        const mFuzzy = textoNorm.match(reFuzzy);
        if (mFuzzy) {
            let val = mFuzzy[1].trim()
                .replace(/^[\d.-]+\s*[-/]\s*/, '')
                .replace(/^[:.-]+\s*/, '')
                .split(/\s{3,}/)[0].trim();
            if (val && val.length > 2) return val;
        }
    }

    // 3. Fallback Heurístico para Nome (Procura nomes em maiúsculo próximo ao início da página)
    if (rotNorm.includes('FUNC') || rotNorm.includes('NOME')) {
        const regexNome = /\b([A-Z]{3,}(?:\s+[A-Z]{2,}){1,4})\b/g;
        const matches = Array.from(textoNorm.matchAll(regexNome));
        for (const m of matches) {
            const n = m[1].trim();
            // Pula termos comuns do cabeçalho
            if (n.length > 8 && !n.includes('ASSOCIACAO') && !n.includes('ESTADUAL') &&
                !n.includes('AMBIENTAL') && n !== rotSimples && !rotNorm.includes(n)) {
                return n;
            }
        }
    }

    return '';
}

function extrairPeriodoRobusto(texto: string): string {
    const textoNorm = normalizarParaBusca(texto);

    // 1. Procura MM/YYYY ou MM.YYYY ou MM-YYYY
    const regexData = /(0[1-9]|1[0-2])\s*[/.-]\s*(20\d{2})/g;
    let m;
    while ((m = regexData.exec(textoNorm)) !== null) {
        return `${m[2]}${m[1]}`;
    }

    // 2. Procura apenas números grudados (ex: 022026 -> 202602)
    const regexGrudado = /\b(0[1-9]|1[0-2])(20\d{2})\b/g;
    const mG = regexGrudado.exec(textoNorm);
    if (mG) return `${mG[2]}${mG[1]}`;

    return '';
}

export function abreviarNome(nome: string): string {
    if (!nome) return '';
    const preposicoes = new Set(['DE', 'DA', 'DO', 'DOS', 'DAS', 'E', 'EM', 'DI']);
    const partes = nome.trim().split(/\s+/).filter(part => part.length > 2 && !preposicoes.has(part.toUpperCase()));
    if (partes.length === 0) return nome;
    if (partes.length === 1) return partes[0];
    return `${partes[0]} ${partes[partes.length - 1]}`;
}

function abreviarDepto(depto: string, mapping: Record<string, string>): string {
    const d = depto.trim().toUpperCase();

    // Sort keys by length descending to ensure the most specific match (longest string) wins
    const sortedKeys = Object.keys(mapping).sort((a, b) => b.length - a.length);

    for (const key of sortedKeys) {
        if (d.includes(key.toUpperCase())) {
            const result = mapping[key];
            console.log(`[Depto Match] "${depto}" -> Key: "${key}" -> Result: "${result}"`);
            return result;
        }
    }
    return depto;
}

export function limparParaArquivo(str: string, sep: string = '_'): string {
    const res = str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9]/g, sep);

    if (sep) {
        // Escapa o separador para uso no RegExp
        const escapedSep = sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return res.replace(new RegExp(`${escapedSep}+`, 'g'), sep).toUpperCase();
    }
    return res.toUpperCase();
}

export async function previewSmartSplit(
    pdfBytes: Uint8Array,
    config: SmartSplitConfig
): Promise<SmartSplitResult[]> {
    const rawPages = await extractRawPagesText(pdfBytes);

    // Debug: Log raw text to help identify why extraction might fail
    console.log('--- SMART SPLIT DEBUG ---');
    console.log('Config:', config);
    rawPages.forEach((text, i) => {
        console.log(`Página ${i + 1} Texto Bruto (primeiros 500 chars):`, text.substring(0, 500));
        // console.log(`Página ${i + 1} Texto Completo:`, text); // Descomente para debug completo
    });
    console.log('-------------------------');

    return rawPages.map((rawText, idx) => {
        const nomeRaw = extrairCampo(rawText, config.rotuloNome);
        const deptoRaw = extrairCampo(rawText, config.rotuloDepto);
        const periodoRaw = extrairPeriodoRobusto(rawText);

        const nomeAbrev = nomeRaw ? abreviarNome(nomeRaw) : '';
        const nomeFinal = nomeAbrev ? limparParaArquivo(nomeAbrev, '') : '';

        const deptoAbrev = deptoRaw ? abreviarDepto(deptoRaw, config.mapeamentoDepto) : '';
        const deptoFinal = deptoAbrev ? limparParaArquivo(deptoAbrev) : '';

        const encontrado = !!(nomeFinal && periodoRaw);

        const nomeArquivo = [
            periodoRaw || 'SEM_PERIODO',
            config.empresa,
            config.projeto,
            deptoFinal || 'SEM_DEPTO',
            config.equipe,
            config.tipoDoc,
            nomeFinal || `PAGINA_${idx + 1}`
        ].filter(Boolean).join('_') + '.pdf';

        return {
            nomeArquivo,
            pagina: idx + 1,
            nomeColaborador: nomeRaw || '',
            periodo: periodoRaw || '',
            depto: deptoRaw || '',
            encontrado,
            rawText: rawText
        };
    });
}
