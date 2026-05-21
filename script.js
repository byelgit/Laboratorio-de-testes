// =========================================================================
// PARTE 1 DE 8: MAPEAMENTO DE ELEMENTOS DO DOM, ESTADO GLOBAL E ESTRUTURAS
// =========================================================================

const Canvas = document.getElementById('logicCanvas');
const ctx = Canvas.getContext('2d');
const cyclesBadge = document.getElementById('cycles-badge');
const zoomInfo = document.getElementById('zoom-info');

// Modos de interação suportados pelo sistema original
let currentMode = 'select';
let gates = [];
let wires = [];

// Cache Estrutural: Otimiza as buscas de O(N) para O(1) sem alterar comportamento
let gateMap = new Map();

// Variável para o Menu Inteligente: memoriza o último tipo de porta selecionado/alterado
let lastSelectedGateType = 'AND';

// Matriz de Transformação da Câmera (Mundo Lógico -> Viewport da Tela)
let transform = { x: 0, y: 0, zoom: 1 };
let isPanning = false;
let panStart = { x: 0, y: 0 };
let initialPinchDist = null;
let initialZoom = 1;
let pinchCenter = { x: 0, y: 0 };

let selectedGate = null;
let draggingGate = null;
let dragOffset = { x: 0, y: 0 };
let activeWireStart = null;
let activeWirePoints = [];
let currentMousePos = { x: 0, y: 0 };

// Gerador de identificadores numéricos incrementais estáveis para prevenir colisões por timestamp
let nextGateId = 1;

/**
 * Atualiza o mapa de busca rápida por ID para evitar buscas repetitivas em laços
 * Esta função reconstrói a estrutura auxiliar sem modificar o array global persistente.
 */
function refreshGateCache() {
    gateMap.clear();
    for (let i = 0; i < gates.length; i++) {
        gateMap.set(gates[i].id, gates[i]);
    }
}

/**
 * Função utilitária para ajustar as dimensões internas do Canvas baseadas no Device Pixel Ratio
 */
function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = Canvas.parentElement.getBoundingClientRect();
    Canvas.width = rect.width * dpr;
    Canvas.height = rect.height * dpr;
    Canvas.style.width = rect.width + 'px';
    Canvas.style.height = rect.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

/**
 * Representação orientada a objetos de uma Porta Lógica ou Módulo Funcional
 */
class Gate {
    constructor(id, type, x, y) {
        this.id = id;
        this.type = type;
        this.x = x;
        this.y = y;
        this.scale = 1.0;
        this.baseWidth = 100;
        this.manualInputs = new Array(32).fill(false);
        this.outputValue = false;
        this.label = null; // Armazena a letra de forma fixa após ser gerada
        this.counterValue = 0; // Estado numérico exclusivo do Contador Binário
        this.outputsCount = 4; // Quantidade de saídas configuráveis do contador (Padrão 4 bits)
        this.setupComponents(type);
        
        // Mantém o sincronismo do ID autoincremental baseado no maior ID existente
        if (id >= nextGateId) {
            nextGateId = id + 1;
        }
    }

    /**
     * Inicializa as contagens internas e larguras da porta conforme seu tipo semântico
     */
    setupComponents(type) {
        this.type = type;
        if (type === 'INPUT_BTN') {
            this.inputsCount = 0;
            this.baseWidth = 60;
        } else if (type === 'OUTPUT_LED') {
            this.inputsCount = 1;
            this.baseWidth = 60;
        } else if (type === 'BINARY_COUNTER') {
            this.inputsCount = 0;
            this.baseWidth = 90;
        } else if (type === 'HEX_DISPLAY') {
            this.inputsCount = 4;
            this.baseWidth = 90;
        } else if (type === 'DISPLAY_7SEG') {
            this.inputsCount = 7;
            this.baseWidth = 80;
        } else {
            this.inputsCount = ['NOT'].includes(type) ? 1 : 2;
            this.baseWidth = 100;
        }
        this.updateDimensions();
    }
// =========================================================================
// PARTE 2 DE 8: MÉTODOS DA CLASSE GATE, CLASSE WIRE E INÍCIO DO MOTOR ORTOGONAL
// =========================================================================

    /**
     * Calcula dinamicamente a largura e altura com base na escala e contagem de pinos
     */
    updateDimensions() {
        this.width = this.baseWidth * this.scale;
        if (this.type === 'INPUT_BTN' || this.type === 'OUTPUT_LED') {
            this.height = 60 * this.scale;
        } else if (this.type === 'BINARY_COUNTER') {
            this.height = Math.max(80, this.outputsCount * 25 + 10) * this.scale;
        } else if (this.type === 'HEX_DISPLAY' || this.type === 'DISPLAY_7SEG') {
            this.height = Math.max(110, this.inputsCount * 25 + 10) * this.scale;
        } else {
            this.height = Math.max(60, this.inputsCount * 25 + 10) * this.scale;
        }
    }

    /**
     * Calcula as coordenadas físicas (X, Y) absolutas no mundo para qualquer pino (in/out)
     */
    getSocketPos(type, index) {
        if (type === 'out') {
            if (this.type === 'OUTPUT_LED' || this.type === 'HEX_DISPLAY' || this.type === 'DISPLAY_7SEG') {
                return { x: this.x + this.width, y: this.y + this.height / 2 };
            }
            if (this.type === 'BINARY_COUNTER') {
                const spacing = this.height / (this.outputsCount + 1);
                return { x: this.x + this.width, y: this.y + spacing * (index + 1) };
            }
            const hasBubble = ['NOT', 'NAND', 'NOR', 'XNOR'].includes(this.type);
            const extraOffset = hasBubble ? (16 * this.scale) : 0;
            return { x: this.x + this.width + extraOffset, y: this.y + this.height / 2 };
        }
        const spacing = this.height / (this.inputsCount + 1);
        return { x: this.x, y: this.y + spacing * (index + 1) };
    }
}

/**
 * Entidade que gerencia as conexões elétricas e propriedades de renderização dos fios
 */
class Wire {
    constructor(from, to) {
        this.from = from;             // Estrutura: { gateId, type: 'in'/'out', index }
        this.to = to;                 // Estrutura: { gateId, type: 'in'/'out', index }
        this.points = [];             // Lista de quinas coordenadas absolutas [{x, y}, ...]
        this.value = false;           // Estado elétrico lógico atual do fio
        this.selectedSegment = null;  // Índice do segmento sendo manipulado no modo 'adjust-wire'
        this.flexRatio = 0.5;         // Fator multiplicador de ajuste (0.0 a 1.0) do canal ortogonal central
    }

    /**
     * Fata o caminho geométrico calculado em segmentos físicos horizontais ou verticais
     */
    getSegments() {
        const segments = [];
        for (let i = 0; i < this.points.length - 1; i++) {
            const p1 = this.points[i];
            const p2 = this.points[i + 1];
            segments.push({
                x1: p1.x, y1: p1.y,
                x2: p2.x, y2: p2.y,
                isVertical: Math.abs(p1.x - p2.x) < 0.5,
                index: i
            });
        }
        return segments;
    }
}

/**
 * Validação estrutural de conexão (Item 5) para blindar o sistema contra acoplamentos inválidos
 */
function isValidConnection(from, to) {
    if (!from || !to) return false;
    // Impede loops diretos no mesmo pino do mesmo componente
    if (from.gateId === to.gateId && from.type === to.type && from.index === to.index) return false;
    // Regra rígida: Não permite conectar entrada com entrada, nem saída com saída
    if (from.type === to.type) return false;
    return true;
}

// =========================================================================
// 2. MOTOR ORTOGONAL DINÂMICO - PRESERVAÇÃO INTEGRAL DE LOGICA DE CURVAS
// =========================================================================
function generateSmartOrthogonalPath(pStart, pEnd, fromType, flexRatio = 0.5) {
    const points = [{ x: pStart.x, y: pStart.y }];
    const dx = pEnd.x - pStart.x;
    const dy = pEnd.y - pStart.y;
    const ESCAPE_DIST = 40; // Mantém a distância de escape confortável original de 40px

    // Se estiverem praticamente alinhados, evita curvas redundantes
    if (Math.abs(dx) < 2) {
        points.push({ x: pStart.x, y: pEnd.y });
        return points;
    }
// =========================================================================
// PARTE 3 DE 8: CONTINUAÇÃO DO MOTOR ORTOGONAL E AVALIAÇÃO DE CIRCUITOS
// =========================================================================

    if (Math.abs(dy) < 2) {
        points.push({ x: pEnd.x, y: pStart.y });
        return points;
    }

    if (fromType === 'out') {
        if (pStart.x < pEnd.x) {
            // Avanço normal para a direita: A linha vertical do meio obedece ao flexRatio
            const midX = pStart.x + dx * flexRatio;
            points.push({ x: midX, y: pStart.y });
            points.push({ x: midX, y: pEnd.y });
        } else {
            // Contorno confortável em U por trás da porta
            const escapeX = pStart.x + ESCAPE_DIST;
            const midY = pStart.y + dy * flexRatio;
            points.push({ x: escapeX, y: pStart.y });
            points.push({ x: escapeX, y: midY });
            points.push({ x: pEnd.x - ESCAPE_DIST, y: midY });
            points.push({ x: pEnd.x - ESCAPE_DIST, y: pEnd.y });
        }
    } else {
        if (pStart.x > pEnd.x) {
            // Avanço reverso para a esquerda
            const escapeX = pStart.x - ESCAPE_DIST;
            const midY = pStart.y + dy * flexRatio;
            points.push({ x: escapeX, y: pStart.y });
            points.push({ x: escapeX, y: midY });
            points.push({ x: pEnd.x + ESCAPE_DIST, y: midY });
            points.push({ x: pEnd.x + ESCAPE_DIST, y: pEnd.y });
        } else {
            // Contorno em U invertido
            const escapeX = pStart.x - ESCAPE_DIST;
            const midY = pStart.y + dy * flexRatio;
            points.push({ x: escapeX, y: pStart.y });
            points.push({ x: escapeX, y: midY });
            points.push({ x: pEnd.x + ESCAPE_DIST, y: midY });
            points.push({ x: pEnd.x + ESCAPE_DIST, y: pEnd.y });
        }
    }

    points.push({ x: pEnd.x, y: pEnd.y });

    // Remove qualquer micro-quina redundante ou sobreposta
    const optimizedPath = [];
    optimizedPath.push(points[0]);
    for (let i = 1; i < points.length; i++) {
        const last = optimizedPath[optimizedPath.length - 1];
        if (Math.abs(last.x - points[i].x) > 0.5 || Math.abs(last.y - points[i].y) > 0.5) {
            optimizedPath.push(points[i]);
        }
    }
    return optimizedPath;
}

// Inicialização dos elementos padrões da viewport original
gates.push(
    new Gate(1, 'AND', 220, 140),
    new Gate(4, 'INPUT_BTN', 60, 80),
    new Gate(5, 'INPUT_BTN', 60, 220),
    new Gate(6, 'OUTPUT_LED', 500, 180)
);
refreshGateCache();

/**
 * Converte coordenadas da tela para coordenadas absolutas no mundo lógico
 */
function screenToWorld(sX, sY) {
    return { x: (sX - transform.x) / transform.zoom, y: (sY - transform.y) / transform.zoom };
}

/**
 * Atribui letras sequenciais estáveis (A-Z, A1-Z1) sem resetar as já geradas
 */
function updateInputLabels() {
    let inputCount = 0;
    gates.forEach(gate => {
        if (gate.type === 'INPUT_BTN') {
            if (!gate.label) {
                const charIndex = inputCount % 26;
                const cycleIndex = Math.floor(inputCount / 26);
                const letter = String.fromCharCode(65 + charIndex);
                gate.label = cycleIndex > 0 ? `${letter}${cycleIndex}` : letter;
            }
            inputCount++;
        }
    });
}

/**
 * Recalcula a rota geométrica ortogonal estritamente sob eventos de mudança (Item 2)
 * Remove essa carga computacional pesada de dentro do render()
 */
function updateWireGeometryCache() {
    for (let i = 0; i < wires.length; i++) {
        const wire = wires[i];
        const gSrc = gateMap.get(wire.from.gateId);
        const gDst = gateMap.get(wire.to.gateId);
        if (gSrc && gDst) {
            const pStart = gSrc.getSocketPos(wire.from.type, wire.from.index);
            const pEnd = gDst.getSocketPos(wire.to.type, wire.to.index);
            wire.points = generateSmartOrthogonalPath(pStart, pEnd, wire.from.type, wire.flexRatio);
        }
    }
}

/**
 * Motor lógico de simulação - Executa propagação de malhas discretas (Nets)
 */
function evaluateCircuit() {
    let maxCycles = 15, stabilized = false, cycleCount = 0;

    while (!stabilized && cycleCount < maxCycles) {
        let changed = false;

        // 1. MAPEAMENTO DE MALHAS (NETS) - Unifica os pinos interconectados
        let pinToNetId = {};
        let nextNetId = 0;

        wires.forEach(wire => {
            const p1 = `${wire.from.gateId}_${wire.from.type}_${wire.from.index}`;
            const p2 = `${wire.to.gateId}_${wire.to.type}_${wire.to.index}`;

            const net1 = pinToNetId[p1];
            const net2 = pinToNetId[p2];

            if (net1 !== undefined && net2 !== undefined) {
                if (net1 !== net2) {
                    for (let pin in pinToNetId) {
                        if (pinToNetId[pin] === net2) pinToNetId[pin] = net1;
                    }
                }
            } else if (net1 !== undefined) {
                pinToNetId[p2] = net1;
            } else if (net2 !== undefined) {
                pinToNetId[p1] = net2;
            } else {
                pinToNetId[p1] = nextNetId;
                pinToNetId[p2] = nextNetId;
                nextNetId++;
            }
        });
// =========================================================================
// PARTE 4 DE 8: ATUALIZAÇÃO DE MALHAS (NETS) E PROCESSAMENTO LÓGICO DAS PORTAS
// =========================================================================

        // 2. COLETA DE SINAIS INJETADOS DA MALHA - Varre todas as fontes geradoras
        let netValues = {};

        gates.forEach(gate => {
            // INPUT_BTN: Injeta sinal em qualquer malha conectada ao seu pino 'out 0'
            if (gate.type === 'INPUT_BTN') {
                const pinKey = `${gate.id}_out_0`;
                const netId = pinToNetId[pinKey];
                if (netId !== undefined) {
                    netValues[netId] = netValues[netId] || [];
                    netValues[netId].push(gate.outputValue);
                }
            }
            // BINARY_COUNTER: Injeta sinal nas malhas conectadas às suas saídas
            else if (gate.type === 'BINARY_COUNTER') {
                for (let i = 0; i < gate.outputsCount; i++) {
                    const pinKey = `${gate.id}_out_${i}`;
                    const netId = pinToNetId[pinKey];
                    if (netId !== undefined) {
                        let bitVal = ((gate.counterValue >> i) & 1) === 1;
                        netValues[netId] = netValues[netId] || [];
                        netValues[netId].push(bitVal);
                    }
                }
            }
            // PORTAS LÓGICAS TRADICIONAIS: Injetam sinal na malha conectada ao seu pino 'out 0'
            else if (gate.type !== 'OUTPUT_LED' && gate.type !== 'HEX_DISPLAY' && gate.type !== 'DISPLAY_7SEG') {
                const pinKey = `${gate.id}_out_0`;
                const netId = pinToNetId[pinKey];
                if (netId !== undefined) {
                    netValues[netId] = netValues[netId] || [];
                    netValues[netId].push(gate.outputValue);
                }
            }
        });

        // 3. ATUALIZAÇÃO VISUAL DOS FIOS - Olha para qualquer ponta do fio para saber o estado da malha
        wires.forEach(wire => {
            const p1 = `${wire.from.gateId}_${wire.from.type}_${wire.from.index}`;
            const p2 = `${wire.to.gateId}_${wire.to.type}_${wire.to.index}`;
            
            // O fio assume o valor se QUALQUER uma de suas pontas estiver conectada a uma malha energizada
            const netId = pinToNetId[p1] !== undefined ? pinToNetId[p1] : pinToNetId[p2];
            
            let wireVal = false;
            if (netId !== undefined && netValues[netId]) {
                wireVal = netValues[netId].some(v => v);
            }
            wire.value = wireVal;
        });

        // 4. PROCESSAMENTO DAS PORTAS LÓGICAS
        gates.forEach(gate => {
            let currentInputs = [];
            for (let i = 0; i < gate.inputsCount; i++) {
                const pinKey = `${gate.id}_in_${i}`;
                const netId = pinToNetId[pinKey];
                
                if (netId !== undefined && netValues[netId]) {
                    currentInputs.push(netValues[netId].some(v => v));
                } else {
                    currentInputs.push(gate.manualInputs[i]);
                }
            }

            let nextOutput = gate.outputValue;

            if (gate.type === 'INPUT_BTN' || gate.type === 'BINARY_COUNTER') {
                return; 
            } 
            else if (gate.type === 'HEX_DISPLAY') {
                let decimalValue = 0;
                currentInputs.forEach((val, idx) => {
                    if (val) decimalValue += Math.pow(2, idx);
                });
                gate.counterValue = decimalValue;
                nextOutput = false;
            } 
            else if (gate.type === 'OUTPUT_LED') {
                nextOutput = currentInputs[0] || false; 
            } 
            else if (gate.type === 'AND') {
                nextOutput = (currentInputs.length > 0 && currentInputs.every(v => v));
            } 
            else if (gate.type === 'OR') {
                nextOutput = currentInputs.some(v => v);
            } 
            else if (gate.type === 'NOT') {
                nextOutput = !currentInputs[0]; 
            } 
            else if (gate.type === 'NAND') {
                nextOutput = !(currentInputs.length > 0 && currentInputs.every(v => v));
            } 
            else if (gate.type === 'NOR') {
                nextOutput = !currentInputs.some(v => v);
            } 
            else if (gate.type === 'XOR') {
                nextOutput = currentInputs.filter(v => v).length % 2 !== 0;
            } 
            else if (gate.type === 'XNOR') {
                nextOutput = currentInputs.filter(v => v).length % 2 === 0;
            }

            if (gate.outputValue !== nextOutput) { 
                gate.outputValue = nextOutput; 
                changed = true; 
            }
        });

        if (!changed) stabilized = true; 
        cycleCount++;
    }
    cyclesBadge.innerText = stabilized ? "Estável" : "Loop Ativo";
    cyclesBadge.style.backgroundColor = stabilized ? "#4caf50" : "#f44336";
}

/**
 * Renderização procedimental individual dos invólucros gráficos das portas lógicas
 */
function drawGateShape(ctx, gate) {
    ctx.save(); 
    ctx.lineWidth = Math.max(1.5, 3 / Math.sqrt(transform.zoom)); 
    ctx.fillStyle = '#1e1e24';
    
    const colors = {
        'AND': '#2196f3', 'NAND': '#00bcd4', 'OR': '#a855f7',    
        'NOR': '#673ab7', 'XOR': '#e91e63', 'XNOR': '#ff2a6d', 
        'NOT': '#ff5722', 'INPUT_BTN': '#4caf50', 'OUTPUT_LED': '#ffeb3b'
    };
    ctx.strokeStyle = colors[gate.type] || '#ffffff';
    
    const x = gate.x, y = gate.y, w = gate.width, h = gate.height;
    const rBubble = 5 * gate.scale;
    
    if (gate.type === 'INPUT_BTN') {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 8 * gate.scale);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.roundRect(x + 8 * gate.scale, y + 8 * gate.scale, w - 16 * gate.scale, h - 16 * gate.scale, 4 * gate.scale);
        ctx.fillStyle = gate.outputValue ? '#00ffcc' : '#2a2a35';
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = gate.outputValue ? '#000000' : '#ffffff';
        ctx.font = `bold ${16 * gate.scale}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(gate.label || 'IN', x + w / 2, y + h / 2);
    }
// =========================================================================
// PARTE 5 DE 8: RENDERIZAÇÃO DOS DISPLAYS E GEOMETRIAS DAS PORTAS LÓGICAS
// =========================================================================

    else if (gate.type === 'OUTPUT_LED') {
        ctx.beginPath();
        ctx.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(x + w / 2, y + h / 2, (w / 2) - 6 * gate.scale, 0, Math.PI * 2);
        ctx.fillStyle = gate.outputValue ? '#ffeb3b' : '#2a2a35';
        ctx.fill();
        if (gate.outputValue) {
            ctx.shadowColor = '#ffeb3b';
            ctx.shadowBlur = 15;
            ctx.fillStyle = '#ffffff';
            ctx.fill();
        }
        ctx.stroke();
    }
    else if (gate.type === 'BINARY_COUNTER') {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 6 * gate.scale);
        ctx.fill();
        ctx.stroke();

        ctx.save();
        ctx.fillStyle = '#050508';
        ctx.strokeStyle = '#2a2a35';
        ctx.lineWidth = 1.5 * gate.scale;
        const displayW = w - 24 * gate.scale;
        const displayH = 34 * gate.scale;
        ctx.roundRect(x + 12 * gate.scale, y + 10 * gate.scale, displayW, displayH, 4 * gate.scale);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ff1144';
        ctx.shadowColor = '#ff1144';
        ctx.shadowBlur = 8 * gate.scale;
        ctx.font = `bold ${20 * gate.scale}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(gate.counterValue, x + w / 2, y + 10 * gate.scale + displayH / 2);
        ctx.restore();
    }
    else if (gate.type === 'HEX_DISPLAY') {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 6 * gate.scale);
        ctx.fill();
        ctx.stroke();

        ctx.save();
        ctx.fillStyle = '#050508';
        ctx.strokeStyle = '#2a2a35';
        ctx.lineWidth = 1.5 * gate.scale;
        const displayW = w - 24 * gate.scale;
        const displayH = 34 * gate.scale;
        ctx.roundRect(x + 12 * gate.scale, y + 10 * gate.scale, displayW, displayH, 4 * gate.scale);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ff1144';
        ctx.shadowColor = '#ff1144';
        ctx.shadowBlur = 8 * gate.scale;
        ctx.font = `bold ${20 * gate.scale}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        let hexChar = (gate.counterValue || 0).toString(16).toUpperCase();
        ctx.fillText(hexChar, x + w / 2, y + 10 * gate.scale + displayH / 2);
        ctx.restore();
    }
    else if (gate.type === 'DISPLAY_7SEG') {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 6 * gate.scale);
        ctx.fill();
        ctx.stroke();

        ctx.save();
        ctx.fillStyle = '#050508';
        ctx.strokeStyle = '#2a2a35';
        ctx.lineWidth = 1.5 * gate.scale;
        const displayW = w - 24 * gate.scale;
        const displayH = h - 20 * gate.scale;
        ctx.roundRect(x + 12 * gate.scale, y + 10 * gate.scale, displayW, displayH, 4 * gate.scale);
        ctx.fill();
        ctx.stroke();

        // Otimização Estrutural: Coleta sinais de forma limpa usando o cache indexado global
        const inputSignals = {};
        for (let i = 0; i < wires.length; i++) {
            const wire = wires[i];
            if (wire.to.gateId === gate.id && wire.to.type === 'in') {
                if (!inputSignals[wire.to.index]) inputSignals[wire.to.index] = [];
                inputSignals[wire.to.index].push(wire.value);
            }
        }

        const segActive = (idx) => {
            return inputSignals[idx] ? inputSignals[idx].some(v => v) : gate.manualInputs[idx];
        };

        const drawSegment = (sx, sy, sw, sh, active) => {
            ctx.save();
            ctx.fillStyle = active ? '#ff1144' : '#1a1a24';
            if (active) {
                ctx.shadowColor = '#ff1144';
                ctx.shadowBlur = 6 * gate.scale;
            }
            ctx.fillRect(sx, sy, sw, sh);
            ctx.restore();
        };

        const cx = x + w / 2;
        const cy = y + h / 2;
        const segW = 18 * gate.scale;
        const segH = 4 * gate.scale;

        drawSegment(cx - segW / 2, cy - segW + segH / 2, segW, segH, segActive(0));
        drawSegment(cx + segW / 2 - segH, cy - segW + segH * 1.5, segH, segW - segH * 2, segActive(1));
        drawSegment(cx + segW / 2 - segH, cy + segH * 0.5, segH, segW - segH * 2, segActive(2));
        drawSegment(cx - segW / 2, cy + segW - segH * 1.5, segW, segH, segActive(3));
        drawSegment(cx - segW / 2, cy + segH * 0.5, segH, segW - segH * 2, segActive(4));
        drawSegment(cx - segW / 2, cy - segW + segH * 1.5, segH, segW - segH * 2, segActive(5));
        drawSegment(cx - segW / 2, cy - segH / 2, segW, segH, segActive(6));

        ctx.restore();
    }
    else if (gate.type === 'AND' || gate.type === 'NAND') {
        ctx.beginPath(); 
        ctx.moveTo(x, y); 
        ctx.lineTo(x + w * 0.5, y);
        ctx.ellipse(x + w * 0.5, y + h / 2, w * 0.5, h / 2, 0, -Math.PI / 2, Math.PI / 2, false);
        ctx.lineTo(x, y + h); 
        ctx.closePath(); 
        ctx.fill(); 
        ctx.stroke();
        
        if (gate.type === 'NAND') {
            ctx.beginPath(); 
            ctx.arc(x + w + rBubble + 1, y + h / 2, rBubble, 0, Math.PI * 2); 
            ctx.fillStyle = '#121216'; ctx.fill(); ctx.stroke();
        }
    } 
    else if (gate.type === 'OR' || gate.type === 'NOR' || gate.type === 'XOR' || gate.type === 'XNOR') {
        const drawOrProfile = () => {
            ctx.moveTo(x, y);
            ctx.quadraticCurveTo(x + w * 0.25, y + h * 0.5, x, y + h);
            ctx.quadraticCurveTo(x + w * 0.5, y + h * 0.95, x + w, y + h * 0.5);
            ctx.quadraticCurveTo(x + w * 0.5, y + h * 0.05, x, y);
        };

        if (gate.type === 'XOR' || gate.type === 'XNOR') {
            ctx.beginPath();
            const offset = 8 * gate.scale;
            ctx.moveTo(x - offset, y);
            ctx.quadraticCurveTo(x - offset + w * 0.25, y + h * 0.5, x - offset, y + h);
            ctx.stroke();
        }

        ctx.beginPath();
        drawOrProfile();
        ctx.closePath(); 
        ctx.fill(); 
        ctx.stroke();

        if (gate.type === 'NOR' || gate.type === 'XNOR') {
            ctx.beginPath(); 
            ctx.arc(x + w + rBubble + 1, y + h / 2, rBubble, 0, Math.PI * 2); 
            ctx.fillStyle = '#121216'; ctx.fill(); ctx.stroke();
        }
    } 
    else if (gate.type === 'NOT') {
        ctx.beginPath(); 
        ctx.moveTo(x, y); 
        ctx.lineTo(x + w * 0.8, y + h * 0.5); 
        ctx.lineTo(x, y + h); 
        ctx.closePath(); 
        ctx.fill(); 
        ctx.stroke();
        
        ctx.beginPath(); 
        ctx.arc(x + w * 0.88 + rBubble, y + h * 0.5, rBubble, 0, Math.PI * 2); 
        ctx.fillStyle = '#121216'; ctx.fill(); ctx.stroke();
    }
    
    ctx.restore();
}
// =========================================================================
// PARTE 6 DE 8: DETECÇÃO DE INTERSECÇÃO, IDENTIFICAÇÃO DE ELEMENTOS E EVENTOS
// =========================================================================

/**
 * Verifica se um clique físico colide com um segmento retilíneo dentro de uma tolerância
 */
function checkLineIntersection(px, py, x1, y1, x2, y2) {
    const threshold = 8;
    if (px < Math.min(x1, x2) - threshold || px > Math.max(x1, x2) + threshold || py < Math.min(y1, y2) - threshold || py > Math.max(y1, y2) + threshold) return false;
    const num = Math.abs((x2 - x1) * (y1 - py) - (x1 - px) * (y2 - y1)), den = Math.hypot(x2 - x1, y2 - y1);
    return den !== 0 && (num / den) < threshold;
}

/**
 * Busca qual componente, socket ou fio está posicionado sob as coordenadas do mundo lógico
 */
function getElementAt(wX, wY) {
    for (let i = 0; i < gates.length; i++) {
        const gate = gates[i];
        if (gate.type === 'BINARY_COUNTER') {
            for (let j = 0; j < gate.outputsCount; j++) {
                if (Math.hypot(gate.getSocketPos('out', j).x - wX, gate.getSocketPos('out', j).y - wY) < (14 * gate.scale)) {
                    return { type: 'socket', gateId: gate.id, socketType: 'out', index: j };
                }
            }
        }
        if (gate.type !== 'INPUT_BTN' && gate.type !== 'BINARY_COUNTER' && Math.hypot(gate.getSocketPos('out', 0).x - wX, gate.getSocketPos('out', 0).y - wY) < (14 * gate.scale)) {
            return { type: 'socket', gateId: gate.id, socketType: 'out', index: 0 };
        }
        if (gate.type === 'INPUT_BTN' && Math.hypot((gate.x + gate.width) - wX, (gate.y + gate.height / 2) - wY) < (14 * gate.scale)) {
            return { type: 'socket', gateId: gate.id, socketType: 'out', index: 0 };
        }
        for (let j = 0; j < gate.inputsCount; j++) {
            if (Math.hypot(gate.getSocketPos('in', j).x - wX, gate.getSocketPos('in', j).y - wY) < (14 * gate.scale)) {
                return { type: 'socket', gateId: gate.id, socketType: 'in', index: j };
            }
        }
    }
    
    for (let i = gates.length - 1; i >= 0; i--) {
        if (wX >= gates[i].x && wX <= gates[i].x + gates[i].width && wY >= gates[i].y && wY <= gates[i].y + gates[i].height) {
            return { type: 'gate', gate: gates[i] };
        }
    }

    if (currentMode === 'adjust-wire') {
        for (let wIdx = 0; wIdx < wires.length; wIdx++) {
            const wire = wires[wIdx];
            if (wire.points && wire.points.length >= 2) {
                const segments = wire.getSegments();
                for (let sIdx = 0; sIdx < segments.length; sIdx++) {
                    const seg = segments[sIdx];
                    
                    // Restrição de tamanho considerável: ignora linhas menores que 16 pixels
                    if (Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1) < 16) continue;

                    if (checkLineIntersection(wX, wY, seg.x1, seg.y1, seg.x2, seg.y2)) {
                        return { type: 'wire', wire: wire, index: wIdx, segmentIndex: sIdx };
                    }
                }
            }
        }
    } 
    else if (currentMode === 'delete') {
        for (let wIdx = 0; wIdx < wires.length; wIdx++) {
            const gSrc = gateMap.get(wires[wIdx].from.gateId);
            const gDst = gateMap.get(wires[wIdx].to.gateId);
            if (gSrc && gDst) {
                let allPts = [gSrc.getSocketPos(wires[wIdx].from.type, wires[wIdx].from.index), ...wires[wIdx].points, gDst.getSocketPos(wires[wIdx].to.type, wires[wIdx].to.index)];
                for (let i = 0; i < allPts.length - 1; i++) {
                    if (checkLineIntersection(wX, wY, allPts[i].x, allPts[i].y, allPts[i+1].x, allPts[i+1].y)) {
                        return { type: 'wire', index: wIdx };
                    }
                }
            }
        }
    }
    return null;
}

/**
 * Normaliza as posições de eventos de mouse ou touch em múltiplos ponteiros
 */
function getEventPositions(e) {
    const rect = Canvas.getBoundingClientRect();
    if (e.touches && e.touches.length > 0) {
        return Array.from(e.touches).map(t => ({ x: t.clientX - rect.left, y: t.clientY - rect.top }));
    }
    return [{ x: e.clientX - rect.left, y: e.clientY - rect.top }];
}

/**
 * Captura o clique inicial ou toque na viewport da tela
 */
function handlePointerStart(e) {
    const pts = getEventPositions(e);
    if (e.touches && e.touches.length === 2) {
        isPanning = false;
        draggingGate = null;
        initialPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        pinchCenter = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        initialZoom = transform.zoom;
        return;
    }

    const wPos = screenToWorld(pts[0].x, pts[0].y);
    currentMousePos = wPos;
    const hit = getElementAt(wPos.x, wPos.y);

    if (currentMode === 'add') {
        // Menu Inteligente: Cria a porta baseada no último tipo memorizado com ID sequencial estável
        const newGate = new Gate(nextGateId, lastSelectedGateType, wPos.x - 50, wPos.y - 30);
        gates.push(newGate);
        refreshGateCache();
        updateWireGeometryCache();
        return;
    }
// =========================================================================
// PARTE 7 DE 8: GERENCIAMENTO DE CLIQUES, CONEXÕES VÁLIDAS E MOVIMENTAÇÃO
// =========================================================================

    if (!hit) {
        if (currentMode === 'wire' && activeWireStart) {
            const srcGate = gateMap.get(activeWireStart.gateId);
            if (srcGate) {
                const pStart = srcGate.getSocketPos(activeWireStart.type, activeWireStart.index);
                const lastPt = activeWirePoints.length > 0 ? activeWirePoints[activeWirePoints.length - 1] : pStart;
                
                const dx = Math.abs(wPos.x - lastPt.x);
                const dy = Math.abs(wPos.y - lastPt.y);
                
                if (dx > dy) {
                    activeWirePoints.push({ x: wPos.x, y: lastPt.y });
                } else {
                    activeWirePoints.push({ x: lastPt.x, y: wPos.y });
                }
            }
            return; 
        } else {
            isPanning = true;
            panStart.x = pts[0].x - transform.x;
            panStart.y = pts[0].y - transform.y;
        }
        return;
    }

    if (currentMode === 'select') {
        if (hit.type === 'gate') {
            if (hit.gate.type === 'INPUT_BTN') {
                hit.gate.outputValue = !hit.gate.outputValue;
            } else if (hit.gate.type === 'BINARY_COUNTER') {
                const maxLimit = Math.pow(2, hit.gate.outputsCount);
                hit.gate.counterValue = (hit.gate.counterValue + 1) % maxLimit;
            }
            draggingGate = hit.gate;
            selectedGate = hit.gate;
            dragOffset.x = wPos.x - hit.gate.x;
            dragOffset.y = wPos.y - hit.gate.y;
        } else if (hit.type === 'socket' && hit.socketType === 'in') {
            const hasWireConnected = wires.some(w => 
                (w.to.gateId === hit.gateId && w.to.type === 'in' && w.to.index === hit.index) ||
                (w.from.gateId === hit.gateId && w.from.type === 'in' && w.from.index === hit.index)
            );
            
            if (!hasWireConnected) {
                const gate = gateMap.get(hit.gateId);
                if (gate) gate.manualInputs[hit.index] = !gate.manualInputs[hit.index];
            }
        }
    }
    else if (currentMode === 'wire' && hit.type === 'socket') {
        if (!activeWireStart) {
            activeWireStart = { gateId: hit.gateId, type: hit.socketType, index: hit.index };
            activeWirePoints = [];
        } else {
            if (activeWireStart.gateId === hit.gateId && activeWireStart.type === hit.socketType && activeWireStart.index === hit.index) {
                activeWireStart = null;
                activeWirePoints = [];
                return;
            }

            // Validação estrutural real (Item 5): Impede conexões inválidas (in->in ou out->out)
            if (!isValidConnection(activeWireStart, { gateId: hit.gateId, type: hit.socketType, index: hit.index })) {
                activeWireStart = null;
                activeWirePoints = [];
                if (typeof showToast === "function") showToast("Conexão inválida!");
                return;
            }

            const isDuplicate = wires.some(w => {
                const matchNormal = (w.from.gateId === activeWireStart.gateId && w.from.type === activeWireStart.type && w.from.index === activeWireStart.index &&
                                     w.to.gateId === hit.gateId && w.to.type === hit.socketType && w.to.index === hit.index);
                const matchInverted = (w.to.gateId === activeWireStart.gateId && w.to.type === activeWireStart.type && w.to.index === activeWireStart.index &&
                                       w.from.gateId === hit.gateId && w.from.type === hit.socketType && w.from.index === hit.index);
                return matchNormal || matchInverted;
            });

            if (isDuplicate) {
                activeWireStart = null;
                activeWirePoints = [];
                if (typeof showToast === "function") showToast("Conexão já existente!");
                return;
            }

            const srcGate = gateMap.get(activeWireStart.gateId);
            const dstGate = gateMap.get(hit.gateId);
            
            if (srcGate && dstGate) {
                const pStart = srcGate.getSocketPos(activeWireStart.type, activeWireStart.index);
                const pEnd = dstGate.getSocketPos(hit.socketType, hit.index);
                activeWirePoints = generateSmartOrthogonalPath(pStart, pEnd, activeWireStart.type);
            }

            wires.push(new Wire({ ...activeWireStart }, { gateId: hit.gateId, type: hit.socketType, index: hit.index }));
            activeWireStart = null;
            activeWirePoints = [];
            updateWireGeometryCache(); // Recalcula a geometria apenas na criação do fio
            if (typeof showToast === "function") showToast("Fio Conectado!");
        }
    }
    else if (currentMode === 'delete') {
        if (hit.type === 'gate') {
            gates = gates.filter(g => g.id !== hit.gate.id);
            wires = wires.filter(w => w.from.gateId !== hit.gate.id && w.to.gateId !== hit.gate.id);
            gates.forEach(g => { if (g.type === 'INPUT_BTN') g.label = null; });
            refreshGateCache();
            updateWireGeometryCache();
        } else if (hit.type === 'wire') {
            wires.splice(hit.index, 1);
            updateWireGeometryCache();
            if (typeof showToast === "function") showToast("Fio Removido!");
        }
    } 
    else if (currentMode === 'config' && hit.type === 'gate') {
        selectedGate = hit.gate;
        if (typeof openConfig === "function") openConfig(hit.gate);
    }
    else if (currentMode === 'adjust-wire' && hit && hit.type === 'wire') {
        selectedGate = hit.wire;
        hit.wire.selectedSegment = hit.segmentIndex;
        dragOffset.x = wPos.x;
        dragOffset.y = wPos.y;
    }
}

/**
 * Gerencia a movimentação do ponteiro (arrasto de elementos, pan e ajustes finos)
 */
function handlePointerMove(e) {
    const pts = getEventPositions(e);
    if (e.touches && e.touches.length === 2 && initialPinchDist) {
        const newDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const newCenter = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        const mouseBeforeZoom = screenToWorld(pinchCenter.x, pinchCenter.y);
        
        transform.zoom = Math.max(0.4, Math.min(3.0, initialZoom * (newDist / initialPinchDist)));
        transform.x = newCenter.x - mouseBeforeZoom.x * transform.zoom;
        transform.y = newCenter.y - mouseBeforeZoom.y * transform.zoom;
        pinchCenter = newCenter;
        return;
    }

    const wPos = screenToWorld(pts[0].x, pts[0].y);
    currentMousePos = wPos;

    if (isPanning) {
        transform.x = pts[0].x - panStart.x;
        transform.y = pts[0].y - panStart.y;
    } else if (currentMode === 'select' && draggingGate) {
        draggingGate.x = wPos.x - dragOffset.x;
        draggingGate.y = wPos.y - dragOffset.y;
        updateWireGeometryCache(); // Recalcula a geometria de fios conectados em tempo de arrasto
    }
    else if (currentMode === 'adjust-wire' && selectedGate && selectedGate.selectedSegment !== null) {
        const wire = selectedGate;
        const gSrc = gateMap.get(wire.from.gateId);
        const gDst = gateMap.get(wire.to.gateId);
        
        if (gSrc && gDst) {
            const pStart = gSrc.getSocketPos(wire.from.type, wire.from.index);
            const pEnd = gDst.getSocketPos(wire.to.type, wire.to.index);
            const segments = wire.getSegments();
            const currentSeg = segments.find(s => s.index === wire.selectedSegment);

            if (currentSeg) {
                if (currentSeg.isVertical) {
                    const totalDx = pEnd.x - pStart.x;
                    if (Math.abs(totalDx) > 5) {
                        const currentPct = (wPos.x - pStart.x) / totalDx;
                        wire.flexRatio = Math.max(0.1, Math.min(0.9, currentPct));
                    }
                } else {
                    const totalDy = pEnd.y - pStart.y;
                    if (Math.abs(totalDy) > 5) {
                        const currentPct = (wPos.y - pStart.y) / totalDy;
                        wire.flexRatio = Math.max(0.1, Math.min(0.9, currentPct));
                    }
                }
                updateWireGeometryCache(); // Atualiza a geometria sob reajuste manual de segmento
            }
        }
    }
}
// =========================================================================
// PARTE 8 DE 8: ENCERRAMENTO DE CLIPES, DESENHO DO RENDER E LISTENERS DO DOM
// =========================================================================

function handlePointerEnd() { 
    if (selectedGate) selectedGate.selectedSegment = null; // LIMPA O ARRASTO DO FIO
    draggingGate = null; 
    isPanning = false; 
    initialPinchDist = null; 
}

/**
 * MÓDULO AUXILIAR DE DESENHO: Renderização de todos os fios estáveis
 */
function drawWires() {
    wires.forEach((wire) => {
        if (!wire.points || wire.points.length === 0) return;

        ctx.beginPath();
        ctx.moveTo(wire.points[0].x, wire.points[0].y);
        for (let i = 1; i < wire.points.length; i++) {
            ctx.lineTo(wire.points[i].x, wire.points[i].y);
        }
        
        ctx.lineWidth = Math.max(2, 4 / Math.sqrt(transform.zoom));
        ctx.strokeStyle = wire.value ? '#00ffcc' : '#444455';
        ctx.stroke();

        // DESTAQUE DE SELEÇÃO: Aciona caixas azuis se estiver no modo exclusivo de Ajustar Fio
        if (currentMode === 'adjust-wire' && selectedGate === wire) {
            ctx.save();
            ctx.lineWidth = Math.max(1, 2 / Math.sqrt(transform.zoom));
            ctx.strokeStyle = '#00f0ff';
            ctx.stroke();
            
            ctx.fillStyle = '#00f0ff';
            for (let i = 1; i < wire.points.length - 1; i++) {
                const pt = wire.points[i];
                const size = 6 / transform.zoom;
                ctx.fillRect(pt.x - size / 2, pt.y - size / 2, size, size);
            }
            ctx.restore();
        }
    });
}

/**
 * MÓDULO AUXILIAR DE DESENHO: Consolidação da pré-visualização inteligente (Item 3)
 */
function drawWirePreview() {
    if (currentMode === 'wire' && activeWireStart) {
        const srcGate = gateMap.get(activeWireStart.gateId);
        if (srcGate) {
            const pStart = srcGate.getSocketPos(activeWireStart.type, activeWireStart.index);
            // Consolidação sem perda de comportamento: exibe a projeção ortogonal laranja em tempo real
            const tempPoints = generateSmartOrthogonalPath(pStart, currentMousePos, activeWireStart.type, 0.5);
            
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(tempPoints[0].x, tempPoints[0].y);
            for (let i = 1; i < tempPoints.length; i++) {
                ctx.lineTo(tempPoints[i].x, tempPoints[i].y);
            }
            ctx.lineWidth = Math.max(1.5, 2 / Math.sqrt(transform.zoom));
            ctx.strokeStyle = '#ff9800';
            ctx.stroke();
            ctx.restore();
        }
    }
}

/**
 * MÓDULO AUXILIAR DE DESENHO: Renderização procedural das portas e sockets de conexão
 */
function drawGates() {
    gates.forEach(gate => {
        drawGateShape(ctx, gate);
        
        // Caixa de contorno azul indicando seleção ativa
        if (selectedGate && selectedGate.id === gate.id && (currentMode === 'select' || currentMode === 'config')) { 
            ctx.save();
            ctx.strokeStyle = '#00f0ff'; 
            ctx.lineWidth = Math.max(1.5, 2 / Math.sqrt(transform.zoom)); 
            
            const hasRecess = ['XOR', 'XNOR'].includes(gate.type);
            const hasBubble = ['NOT', 'NAND', 'NOR', 'XNOR'].includes(gate.type);
            
            const minX = gate.x - (hasRecess ? 8 * gate.scale : 0);
            const maxX = gate.x + gate.width + (hasBubble ? 16 * gate.scale : 0);
            
            const padding = 6;
            const finalWidth = maxX - minX;
            
            ctx.strokeRect(
                minX - padding, 
                gate.y - padding, 
                finalWidth + (padding * 2), 
                gate.height + (padding * 2)
            ); 
            ctx.restore();
        }
        
        if (gate.type !== 'INPUT_BTN' && gate.type !== 'OUTPUT_LED') {
            ctx.fillStyle = '#888899'; 
            ctx.font = `${10 * gate.scale}px sans-serif`; 
            ctx.textAlign = 'center'; 
            ctx.fillText(gate.type, gate.x + gate.width / 2, gate.y - 6);
        }
        
        // Renderização dos pinos de entrada (Sockets)
        for (let i = 0; i < gate.inputsCount; i++) {
            const pos = gate.getSocketPos('in', i);
            
            // Otimização: Verifica acoplamento usando busca direta em vez de múltiplos laços repetitivos
            const connectedWires = wires.filter(w => 
                (w.to.gateId === gate.id && w.to.type === 'in' && w.to.index === i) ||
                (w.from.gateId === gate.id && w.from.type === 'in' && w.from.index === i)
            );
            const hasWire = connectedWires.length > 0;
            
            let val = gate.manualInputs[i];
            if (hasWire) {
                val = connectedWires.some(w => w.value);
            }
            
            ctx.fillStyle = val ? '#00ffcc' : '#2a2a35'; 
            ctx.strokeStyle = '#ffffff'; 
            ctx.beginPath(); 
            ctx.arc(pos.x, pos.y, 5 * gate.scale, 0, Math.PI * 2); 
            ctx.fill(); 
            ctx.stroke();

            if (!hasWire) { 
                ctx.fillStyle = '#ffffff'; 
                ctx.font = '9px sans-serif'; 
                ctx.fillText(val ? "1" : "0", pos.x - 10, pos.y + 3); 
            }
        }

        // Renderização dos pinos de saída (Sockets)
        if (gate.type !== 'OUTPUT_LED' && gate.type !== 'BINARY_COUNTER' && gate.type !== 'HEX_DISPLAY' && gate.type !== 'DISPLAY_7SEG') {
            const outPos = gate.getSocketPos('out', 0); 
            ctx.fillStyle = gate.outputValue ? '#00ffcc' : '#2a2a35'; 
            ctx.strokeStyle = '#ffffff'; 
            ctx.beginPath(); 
            ctx.arc(outPos.x, outPos.y, 5 * gate.scale, 0, Math.PI * 2); 
            ctx.fill(); 
            ctx.stroke();
        } else if (gate.type === 'BINARY_COUNTER') {
            for (let i = 0; i < gate.outputsCount; i++) {
                const outPos = gate.getSocketPos('out', i);
                let bitVal = ((gate.counterValue >> i) & 1) === 1;
                ctx.fillStyle = bitVal ? '#00ffcc' : '#2a2a35'; 
                ctx.strokeStyle = '#ffffff'; 
                ctx.beginPath(); 
                ctx.arc(outPos.x, outPos.y, 5 * gate.scale, 0, Math.PI * 2); 
                ctx.fill(); 
                ctx.stroke();
            }
        }
    });
}

/**
 * Função central de renderização (Pura e livre de mutações de estado persistente)
 */
function render() {
    ctx.clearRect(0, 0, Canvas.width, Canvas.height); 
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.zoom, transform.zoom);

    // Ajuste semântico e visual estável preservado quadro a quadro
    updateInputLabels();

    // Invocações estritas dos submódulos de pintura procedural (Desacoplamento)
    drawWires();
    drawWirePreview();
    drawGates();

    ctx.restore(); 
    zoomInfo.innerText = `Zoom: ${Math.round(transform.zoom * 100)}%`;
}

// Ouvintes de eventos e tratamentos nativos de zoom
Canvas.addEventListener('wheel', (e) => {
    e.preventDefault(); 
    const pts = getEventPositions(e);
    const mouseBeforeZoom = screenToWorld(pts[0].x, pts[0].y);
    
    transform.zoom = e.deltaY < 0 ? Math.min(3.0, transform.zoom + 0.1) : Math.max(0.4, transform.zoom - 0.1);
    transform.x = pts[0].x - mouseBeforeZoom.x * transform.zoom; 
    transform.y = pts[0].y - mouseBeforeZoom.y * transform.zoom;
}, { passive: false });

Canvas.addEventListener('mousedown', handlePointerStart); 
Canvas.addEventListener('mousemove', handlePointerMove); 
window.addEventListener('mouseup', handlePointerEnd);

Canvas.addEventListener('touchstart', (e) => { e.preventDefault(); handlePointerStart(e); }, { passive: false }); 
Canvas.addEventListener('touchmove', (e) => { e.preventDefault(); handlePointerMove(e); }, { passive: false }); 
Canvas.addEventListener('touchend', handlePointerEnd);

document.querySelectorAll('#toolbar .btn').forEach(btn => btn.addEventListener('click', (e) => {
    document.querySelectorAll('#toolbar .btn').forEach(b => b.classList.remove('active')); 
    e.currentTarget.classList.add('active');
    currentMode = e.currentTarget.getAttribute('data-mode'); 
    activeWireStart = null; 
    activeWirePoints = []; 
    selectedGate = null; 
    closeConfig();
}));

function showToast(msg) { 
    const t = document.getElementById('toast'); 
    if(t) {
        t.innerText = msg; t.style.opacity = 1; setTimeout(() => t.style.opacity = 0, 1500); 
    }
}

function openConfig(gate) {
    document.getElementById('gate-type-select').value = gate.type;
    document.getElementById('gate-inputs-count').value = gate.inputsCount;
    document.getElementById('gate-scale').value = gate.scale;
    document.getElementById('config-panel').classList.add('visible');

    const inputCountField = document.getElementById('gate-inputs-count');
    if (inputCountField && inputCountField.parentElement) {
        const group = inputCountField.parentElement;
        const label = group.querySelector('label');
        const type = gate.type;

        if (type === 'INPUT_BTN' || type === 'OUTPUT_LED' || type === 'DISPLAY_7SEG') {
            group.style.display = 'none';
        } else {
            group.style.display = 'flex';
            if (label) {
                label.innerText = type === 'BINARY_COUNTER' ? 'Quantidade de Saídas' : 'Quantidade de Entradas';
            }
        }

        document.getElementById('gate-type-select').onchange = (e) => {
            const currentType = e.target.value;
            if (currentType === 'INPUT_BTN' || currentType === 'OUTPUT_LED' || currentType === 'DISPLAY_7SEG') {
                group.style.display = 'none';
            } else {
                group.style.display = 'flex';
                if (label) {
                    label.innerText = currentType === 'BINARY_COUNTER' ? 'Quantidade de Saídas' : 'Quantidade de Entradas';
                }
            }
        };
    }
}

function closeConfig() { document.getElementById('config-panel').classList.remove('visible'); }

function applyGateConfig() { 
    if (!selectedGate) return; 
    const newType = document.getElementById('gate-type-select').value; 
    
    if (selectedGate.type !== newType) {
        lastSelectedGateType = newType;
    }
    
    selectedGate.setupComponents(newType); 
    selectedGate.scale = parseFloat(document.getElementById('gate-scale').value) || 1.0; 
    
    let count = parseInt(document.getElementById('gate-inputs-count').value) || 2; 
    if (selectedGate.type !== 'INPUT_BTN' && selectedGate.type !== 'OUTPUT_LED' && selectedGate.type !== 'BINARY_COUNTER' && selectedGate.type !== 'HEX_DISPLAY' && selectedGate.type !== 'DISPLAY_7SEG') {
        selectedGate.inputsCount = ['NOT'].includes(selectedGate.type) ? 1 : Math.min(32, Math.max(1, count));
    }
    if (selectedGate.type === 'HEX_DISPLAY') {
        selectedGate.inputsCount = Math.min(32, Math.max(1, count));
    }
    if (selectedGate.type === 'DISPLAY_7SEG') {
        selectedGate.inputsCount = 7;
    }
    if (selectedGate.type === 'BINARY_COUNTER') {
        selectedGate.inputsCount = 0;
        selectedGate.outputsCount = Math.min(32, Math.max(1, count));
        const maxLimit = Math.pow(2, selectedGate.outputsCount);
        selectedGate.counterValue = selectedGate.counterValue % maxLimit;
    }
    selectedGate.updateDimensions();

    wires = wires.filter(w => {
        if (w.to.gateId === selectedGate.id && w.to.type === 'in' && w.to.index >= selectedGate.inputsCount) return false;
        if (w.from.gateId === selectedGate.id && selectedGate.type === 'OUTPUT_LED' && w.from.type === 'out') return false;
        if (w.from.gateId === selectedGate.id && selectedGate.type === 'BINARY_COUNTER' && w.from.type === 'out' && w.from.index >= selectedGate.outputsCount) return false;
        return true;
    });

    updateWireGeometryCache(); // Sincroniza a malha geométrica após mutação de configuração
    closeConfig(); 
}

// Inicializador de Loops Concorrentes da Aplicação
function loop() { evaluateCircuit(); render(); requestAnimationFrame(loop); } 

// Força a primeira carga de geometria para estabilização inicial dos fios criados estaticamente
updateWireGeometryCache();
requestAnimationFrame(loop);

const gateSelectElement = document.getElementById('gate-type-select');
if (gateSelectElement) {
    if (!gateSelectElement.querySelector('option[value="HEX_DISPLAY"]')) {
        const opt = document.createElement('option'); opt.value = 'HEX_DISPLAY'; opt.textContent = 'Display Hexadecimal';
        gateSelectElement.appendChild(opt);
    }
    if (!gateSelectElement.querySelector('option[value="DISPLAY_7SEG"]')) {
        const opt = document.createElement('option'); opt.value = 'DISPLAY_7SEG'; opt.textContent = 'Display 7 Segmentos';
        gateSelectElement.appendChild(opt);
    }
}
