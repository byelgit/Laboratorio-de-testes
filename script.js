const Canvas = document.getElementById('logicCanvas');
const ctx = Canvas.getContext('2d');
const cyclesBadge = document.getElementById('cycles-badge');
const zoomInfo = document.getElementById('zoom-info');

let currentMode = 'select';
let gates = [];
let wires = [];

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
    }
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

            getSocketPos(type, index) {
        if (type === 'out') {
            if (this.type === 'OUTPUT_LED' || this.type === 'HEX_DISPLAY' || this.type === 'DISPLAY_7SEG') return { x: this.x + this.width, y: this.y + this.height / 2 };
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

class Wire {
    constructor(from, to, points = []) {
        this.from = from;         // { gateId, type: 'in'/'out', index }
        this.to = to;             // { gateId, type: 'in'/'out', index }
        this.points = points;     // Lista de nós intermediários [{x, y}, ...]
        this.value = false;       // Estado lógico
        this.selectedSegment = null; // Índice do segmento sendo arrastado atualmente
    }

    // Calcula dinamicamente os segmentos de reta (H ou V) formados pelos pontos
    getSegments() {
        const segments = [];
        for (let i = 0; i < this.points.length - 1; i++) {
            const p1 = this.points[i];
            const p2 = this.points[i + 1];
            segments.push({
                x1: p1.x, y1: p1.y,
                x2: p2.x, y2: p2.y,
                isVertical: Math.abs(p1.x - p2.x) < 0.1
            });
        }
        return segments;
    }
}
// // // =========================================================================
// 2. MOTOR ORTOGONAL DINÂMICO - SIMÉTRICO E COM FOLGAS CONFORTÁVEIS NOS DOIS SENTIDOS
// =========================================================================
function generateSmartOrthogonalPath(pStart, pEnd, fromType) {
    const points = [{ x: pStart.x, y: pStart.y }];
    
    const dx = pEnd.x - pStart.x;
    const dy = pEnd.y - pStart.y;

    // Se estiverem praticamente alinhados em linha reta, conecta direto sem curvas bobas
    if (Math.abs(dx) < 2) {
        points.push({ x: pStart.x, y: pEnd.y });
        return points;
    }
    if (Math.abs(dy) < 2) {
        points.push({ x: pEnd.x, y: pStart.y });
        return points;
    }

    const ESCAPE_DIST = 40; // Distância confortável de afastamento das portas lógicas

    if (fromType === 'out') {
        // CONEXÃO EXECUTADA DA ESQUERDA PARA A DIREITA
        if (pStart.x < pEnd.x) {
            // Avanço normal: Zigue-zague limpo pelo ponto médio (Z-Shape)
            const midX = pStart.x + dx * 0.5;
            points.push({ x: midX, y: pStart.y });
            points.push({ x: midX, y: pEnd.y });
        } else {
            // Retorno em U (Fio contornando por trás): Afasta para a direita e faz a volta
            const escapeX = pStart.x + ESCAPE_DIST; 
            points.push({ x: escapeX, y: pStart.y });
            points.push({ x: escapeX, y: pStart.y + dy * 0.5 });
            points.push({ x: pEnd.x - ESCAPE_DIST, y: pStart.y + dy * 0.5 });
            points.push({ x: pEnd.x - ESCAPE_DIST, y: pEnd.y });
        }
    } else {
        // CONEXÃO EXECUTADA DA DIREITA PARA A ESQUERDA (Clique começou na Entrada)
        if (pStart.x > pEnd.x) {
            // Avanço normal para trás: Afasta primeiro para a esquerda (fuga do componente)
            const escapeX = pStart.x - ESCAPE_DIST;
            points.push({ x: escapeX, y: pStart.y });
            points.push({ x: escapeX, y: pEnd.y });
        } else {
            // Retorno em U invertido: Afasta para a esquerda e faz o contorno confortável
            const escapeX = pStart.x - ESCAPE_DIST;
            points.push({ x: escapeX, y: pStart.y });
            points.push({ x: escapeX, y: pStart.y + dy * 0.5 });
            points.push({ x: pEnd.x + ESCAPE_DIST, y: pStart.y + dy * 0.5 });
            points.push({ x: pEnd.x + ESCAPE_DIST, y: pEnd.y });
        }
    }

    points.push({ x: pEnd.x, y: pEnd.y });

    // Filtro de otimização: Limpa quinas duplicadas ou redundâncias
    const optimizedPath = [];
    optimizedPath.push(points[0]);
    for (let i = 1; i < points.length; i++) {
        const last = optimizedPath[optimizedPath.length - 1];
        if (Math.hypot(last.x - points[i].x, last.y - points[i].y) > 0.5) {
            optimizedPath.push(points[i]);
        }
    }
    return optimizedPath;
}

// Elementos iniciais da viewport (Nome agora são calculados dinamicamente)
gates.push(
    new Gate(1, 'AND', 220, 140),
    new Gate(4, 'INPUT_BTN', 60, 80),
    new Gate(5, 'INPUT_BTN', 60, 220),
    new Gate(6, 'OUTPUT_LED', 500, 180)
);

function screenToWorld(sX, sY) {
    return { x: (sX - transform.x) / transform.zoom, y: (sY - transform.y) / transform.zoom };
}

// FUNÇÃO AUXILIAR: Atribui letras sequenciais de A-Z, seguidas por A1-Z1, A2-Z2 sem resetar os já criados
function updateInputLabels() {
    let inputCount = 0;
    gates.forEach(gate => {
        if (gate.type === 'INPUT_BTN') {
            if (!gate.label) {
                const charIndex = inputCount % 26;
                const cycleIndex = Math.floor(inputCount / 26);
                const letter = String.fromCharCode(65 + charIndex);
                // Se cycleIndex for maior que 0, adiciona o número após a letra (Ex: A1, B1, A2...)
                gate.label = cycleIndex > 0 ? `${letter}${cycleIndex}` : letter;
            }
            inputCount++;
        }
    });
}

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

        const inputSignals = {};
        wires.forEach(wire => {
            if (wire.to.gateId === gate.id && wire.to.type === 'in') {
                (inputSignals[wire.to.index] = inputSignals[wire.to.index] || []).push(wire.value);
            }
        });

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

function checkLineIntersection(px, py, x1, y1, x2, y2) {
    const threshold = 8;
    if (px < Math.min(x1, x2) - threshold || px > Math.max(x1, x2) + threshold || py < Math.min(y1, y2) - threshold || py > Math.max(y1, y2) + threshold) return false;
    const num = Math.abs((x2 - x1) * (y1 - py) - (x1 - px) * (y2 - y1)), den = Math.hypot(x2 - x1, y2 - y1);
    return den !== 0 && (num / den) < threshold;
}

function getElementAt(wX, wY) {
    for (let gate of gates) {
        if (gate.type === 'BINARY_COUNTER') {
            for (let i = 0; i < gate.outputsCount; i++) {
                if (Math.hypot(gate.getSocketPos('out', i).x - wX, gate.getSocketPos('out', i).y - wY) < (14 * gate.scale)) {
                    return { type: 'socket', gateId: gate.id, socketType: 'out', index: i };
                }
            }
        }
        if (gate.type !== 'INPUT_BTN' && gate.type !== 'BINARY_COUNTER' && Math.hypot(gate.getSocketPos('out', 0).x - wX, gate.getSocketPos('out', 0).y - wY) < (14 * gate.scale)) return { type: 'socket', gateId: gate.id, socketType: 'out', index: 0 };
        if (gate.type === 'INPUT_BTN' && Math.hypot((gate.x + gate.width) - wX, (gate.y + gate.height / 2) - wY) < (14 * gate.scale)) return { type: 'socket', gateId: gate.id, socketType: 'out', index: 0 };
        for (let i = 0; i < gate.inputsCount; i++) if (Math.hypot(gate.getSocketPos('in', i).x - wX, gate.getSocketPos('in', i).y - wY) < (14 * gate.scale)) return { type: 'socket', gateId: gate.id, socketType: 'in', index: i };
    }
    for (let i = gates.length - 1; i >= 0; i--) if (wX >= gates[i].x && wX <= gates[i].x + gates[i].width && wY >= gates[i].y && wY <= gates[i].y + gates[i].height) return { type: 'gate', gate: gates[i] };
    for (let wIdx = 0; wIdx < wires.length; wIdx++) {
        const gSrc = gates.find(g => g.id === wires[wIdx].from.gateId), gDst = gates.find(g => g.id === wires[wIdx].to.gateId);
        if (gSrc && gDst) {
            let allPts = [gSrc.getSocketPos(wires[wIdx].from.type, wires[wIdx].from.index), ...wires[wIdx].points, gDst.getSocketPos(wires[wIdx].to.type, wires[wIdx].to.index)];
            for (let i = 0; i < allPts.length - 1; i++) if (checkLineIntersection(wX, wY, allPts[i].x, allPts[i].y, allPts[i+1].x, allPts[i+1].y)) return { type: 'wire', index: wIdx };
        }
    }
    return null;
}


function getEventPositions(e) {
    const rect = Canvas.getBoundingClientRect();
    if (e.touches && e.touches.length > 0) {
        return Array.from(e.touches).map(t => ({ x: t.clientX - rect.left, y: t.clientY - rect.top }));
    }
    return [{ x: e.clientX - rect.left, y: e.clientY - rect.top }];
}

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
        // Menu Inteligente: Cria a porta baseada no último tipo memorizado
        gates.push(new Gate(Date.now(), lastSelectedGateType, wPos.x - 50, wPos.y - 30));
        return;
    }

            if (!hit) {
        if (currentMode === 'wire' && activeWireStart) {
            const srcGate = gates.find(g => g.id === activeWireStart.gateId);
            if (srcGate) {
                const pStart = srcGate.getSocketPos(activeWireStart.type, activeWireStart.index);
                const lastPt = activeWirePoints.length > 0 ? activeWirePoints[activeWirePoints.length - 1] : pStart;
                
                const dx = Math.abs(wPos.x - lastPt.x);
                const dy = Math.abs(wPos.y - lastPt.y);
                
                // Salva apenas um único ponto na direção predominante do clique
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
            // CORREÇÃO: Verifica se o pino de entrada possui QUALQUER fio conectado a ele antes de permitir a alteração manual
            const hasWireConnected = wires.some(w => 
                (w.to.gateId === hit.gateId && w.to.type === 'in' && w.to.index === hit.index) ||
                (w.from.gateId === hit.gateId && w.from.type === 'in' && w.from.index === hit.index)
            );
            
            if (!hasWireConnected) {
                const gate = gates.find(g => g.id === hit.gateId);
                if (gate) gate.manualInputs[hit.index] = !gate.manualInputs[hit.index];
            }
        }
    }
               // =========================================================================
    // MODO FIAÇÃO ATUALIZADO COM TRAVA DE DUPLICIDADE (ANTI-AMBIGUIDADE)
    // =========================================================================
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

            const srcGate = gates.find(g => g.id === activeWireStart.gateId);
            const dstGate = gates.find(g => g.id === hit.gateId);
            
            if (srcGate && dstGate) {
                const pStart = srcGate.getSocketPos(activeWireStart.type, activeWireStart.index);
                const pEnd = dstGate.getSocketPos(hit.socketType, hit.index);
                activeWirePoints = generateSmartOrthogonalPath(pStart, pEnd, activeWireStart.type);
            }

            wires.push(new Wire({ ...activeWireStart }, { gateId: hit.gateId, type: hit.socketType, index: hit.index }, [...activeWirePoints]));
            activeWireStart = null;
            activeWirePoints = [];
            if (typeof showToast === "function") showToast("Fio Conectado!");
        }
    }



 else if (currentMode === 'delete') {
        if (hit.type === 'gate') {
            gates = gates.filter(g => g.id !== hit.gate.id);
            wires = wires.filter(w => w.from.gateId !== hit.gate.id && w.to.gateId !== hit.gate.id);
            // Ao deletar, forçamos um reset completo dos nomes para reorganizar sem buracos
            gates.forEach(g => { if (g.type === 'INPUT_BTN') g.label = null; });
        } else if (hit.type === 'wire') {
            wires.splice(hit.index, 1);
            showToast("Fio Removido!");
        }
    } else if (currentMode === 'config' && hit.type === 'gate') {
        selectedGate = hit.gate;
        openConfig(hit.gate);
    }
}

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
    }
}

function handlePointerEnd() { draggingGate = null; isPanning = false; initialPinchDist = null; }
function varColor(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function render() {
    ctx.clearRect(0, 0, Canvas.width, Canvas.height); 
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.zoom, transform.zoom);

    // INTEGRAÇÃO: Garante o reajuste dinâmico das letras a cada novo frame de desenho
    updateInputLabels();

        // =========================================================================
    // TRECHO ATUALIZADO DE FIAÇÃO DENTRO DO SEU RENDER()
    // =========================================================================
    
    // 1. Desenho e Recálculo Automático dos Fios Conectados
    wires.forEach((wire, wIdx) => {
        const gSrc = gates.find(g => g.id === wire.from.gateId);
        const gDst = gates.find(g => g.id === wire.to.gateId);
        if (!gSrc || !gDst) return;

        const pStart = gSrc.getSocketPos(wire.from.type, wire.from.index);
        const pEnd = gDst.getSocketPos(wire.to.type, wire.to.index);

        // SE O FIO NÃO ESTÁ SENDO ARRASTADO MANUALMENTE: Recalcula o trajeto ortogonal ideal fugindo das portas
        if (wire.selectedSegment === null) {
            wire.points = generateSmartOrthogonalPath(pStart, pEnd, wire.from.type, gSrc.id);
        } else {
            // Se estiver em edição manual, garante apenas que os extremos sigam cravados nos pinos
            if (wire.points.length >= 2) {
                wire.points[0].x = pStart.x;
                wire.points[0].y = pStart.y;
                wire.points[wire.points.length - 1].x = pEnd.x;
                wire.points[wire.points.length - 1].y = pEnd.y;
            }
        }

        // Desenha a trilha ortogonal
        ctx.beginPath();
        ctx.moveTo(wire.points[0].x, wire.points[0].y);
        for (let i = 1; i < wire.points.length; i++) {
            ctx.lineTo(wire.points[i].x, wire.points[i].y);
        }
        
        ctx.lineWidth = Math.max(2, 4 / Math.sqrt(transform.zoom));
        ctx.strokeStyle = wire.value ? '#00ffcc' : '#444455';
        ctx.stroke();

        // Se estiver no modo Config e o fio for o selecionado, destaca as quinas
        if (currentMode === 'config' && selectedGate === wire) {
            ctx.save();
            ctx.lineWidth = Math.max(1, 2 / Math.sqrt(transform.zoom));
            ctx.strokeStyle = '#00f0ff';
            ctx.stroke();
            
            // Desenha os nós manipuladores nas dobras das esquinas
            ctx.fillStyle = '#00f0ff';
            for (let i = 1; i < wire.points.length - 1; i++) {
                const pt = wire.points[i];
                const size = 6 / transform.zoom;
                ctx.fillRect(pt.x - size / 2, pt.y - size / 2, size, size);
            }
            ctx.restore();
        }
    });

    // 2. Pré-visualização inteligente do fio ortogonal em tempo de criação
    if (currentMode === 'wire' && activeWireStart) {
        const srcGate = gates.find(g => g.id === activeWireStart.gateId);
        if (srcGate) {
            const pStart = srcGate.getSocketPos(activeWireStart.type, activeWireStart.index);
            // Mostra em tempo real como o fio vai desviar dos blocos antes mesmo do clique final
            const tempPoints = generateSmartOrthogonalPath(pStart, currentMousePos, activeWireStart.type, srcGate.id);
            
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


    gates.forEach(gate => {
        drawGateShape(ctx, gate);
        
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
            ctx.fillStyle = '#888899'; ctx.font = `${10 * gate.scale}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText(gate.type, gate.x + gate.width / 2, gate.y - 6);
        }
        
                        // -------------------------------------------------------------------------
        // TRECHO CORRIGIDO DENTRO DO RENDER PARA ENTRADAS BIDIRECIONAIS
        // -------------------------------------------------------------------------
        for (let i = 0; i < gate.inputsCount; i++) {
            const pos = gate.getSocketPos('in', i);
            
            // CORREÇÃO: Verifica se há fio conectado olhando para AMBAS as pontas (to ou from)
            const hasWire = wires.some(w => 
                (w.to.gateId === gate.id && w.to.type === 'in' && w.to.index === i) ||
                (w.from.gateId === gate.id && w.from.type === 'in' && w.from.index === i)
            );
            
            // CORREÇÃO: Coleta o sinal elétrico real trafegando por qualquer fio conectado a este pino
            let val = gate.manualInputs[i];
            if (hasWire) {
                const connectedWires = wires.filter(w => 
                    (w.to.gateId === gate.id && w.to.type === 'in' && w.to.index === i) ||
                    (w.from.gateId === gate.id && w.from.type === 'in' && w.from.index === i)
                );
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
        // -------------------------------------------------------------------------

        
                        if (gate.type !== 'OUTPUT_LED' && gate.type !== 'BINARY_COUNTER' && gate.type !== 'HEX_DISPLAY' && gate.type !== 'DISPLAY_7SEG') {
            const outPos = gate.getSocketPos('out', 0); ctx.fillStyle = gate.outputValue ? '#00ffcc' : '#2a2a35'; ctx.strokeStyle = '#ffffff'; ctx.beginPath(); ctx.arc(outPos.x, outPos.y, 5 * gate.scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        } else if (gate.type === 'BINARY_COUNTER') {
            for (let i = 0; i < gate.outputsCount; i++) {
                const outPos = gate.getSocketPos('out', i);
                let bitVal = ((gate.counterValue >> i) & 1) === 1;
                ctx.fillStyle = bitVal ? '#00ffcc' : '#2a2a35'; ctx.strokeStyle = '#ffffff'; ctx.beginPath(); ctx.arc(outPos.x, outPos.y, 5 * gate.scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            }
        }


    });
    ctx.restore(); 
     
    zoomInfo.innerText = `Zoom: ${Math.round(transform.zoom * 100)}%`;
}

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
    document.querySelectorAll('#toolbar .btn').forEach(b => b.classList.remove('active')); e.currentTarget.classList.add('active');
    currentMode = e.currentTarget.getAttribute('data-mode'); activeWireStart = null; activeWirePoints = []; selectedGate = null; closeConfig();
}));

function showToast(msg) { const t = document.getElementById('toast'); t.innerText = msg; t.style.opacity = 1; setTimeout(() => t.style.opacity = 0, 1500); }
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
    
    // Menu Inteligente: Se alterou o tipo da porta, salva na memória global
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

    closeConfig(); 
}

function loop() { evaluateCircuit(); render(); requestAnimationFrame(loop); } 
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
