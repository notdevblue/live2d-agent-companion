import { CubismFramework } from '@cubism/live2dcubismframework';
import { CubismUserModel } from '@cubism/model/cubismusermodel';
import { CubismMotionManager } from '@cubism/motion/cubismmotionmanager';
import { CubismMatrix44 } from '@cubism/math/cubismmatrix44';
import type { CharacterCue, ModelInventory } from '../shared/contracts.js';

interface Motion {
  setLoop(loop: boolean): void;
  setFadeInTime(value: number): void;
  setFadeOutTime(value: number): void;
  setEffectIds(eyeBlink: unknown[], lipSync: unknown[]): void;
}
interface Model {
  loadParameters(): void;
  saveParameters(): void;
  update(): void;
  getParameterCount(): number;
  getParameterId(index: number): unknown;
  getParameterValueByIndex(index: number): number;
  setParameterValueByIndex(index: number, value: number, weight?: number): void;
  getCanvasWidth(): number;
  getCanvasHeight(): number;
}
interface Runtime {
  loadModel(buffer: ArrayBuffer, consistency: boolean): void;
  loadPhysics(buffer: ArrayBuffer, size: number): void;
  loadMotion(buffer: ArrayBuffer, size: number, name: string): Motion;
  getModel(): Model;
  getModelMatrix(): { setHeight(height: number): void; getArray(): Float32Array };
  createRenderer(width: number, height: number): void;
  getRenderer(): {
    startUp(gl: WebGLRenderingContext): void;
    bindTexture(index: number, texture: WebGLTexture): void;
    setIsPremultipliedAlpha(value: boolean): void;
    setMvpMatrix(matrix: unknown): void;
    setRenderState(fbo: WebGLFramebuffer | null, viewport: number[]): void;
    loadShaders(path: string): void;
    drawModel(): void;
  };
  _physics?: { evaluate(model: Model, dt: number): void };
  release(): void;
}
interface ExpressionParameter {
  index: number;
  value: number;
  blend: 'Add' | 'Multiply' | 'Overwrite';
}
interface Manifest {
  FileReferences: {
    Moc: string;
    Textures: string[];
    Physics?: string;
    Expressions?: Array<{ Name: string; File: string }>;
    Motions?: Record<string, Array<{ File: string }>>;
  };
  Groups?: Array<{ Name: string; Ids: string[] }>;
}

export class Avatar {
  private runtime!: Runtime;
  private gl!: WebGLRenderingContext;
  private model!: Model;
  private motionManager = new CubismMotionManager();
  private motions = new Map<string, Motion>();
  private expressions = new Map<string, ExpressionParameter[]>();
  private indexes = new Map<string, number>();
  private textures: WebGLTexture[] = [];
  private idle?: Motion;
  private expression: ExpressionParameter[] = [];
  private expressionUntil = 0;
  private expressionStarted = 0;
  private lastGesture = 0;
  private previous = 0;
  private frame = 0;
  private disposed = false;
  private state = 'idle';
  private blinkIds: string[] = [];
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly inventory: ModelInventory,
  ) {}

  async load(): Promise<void> {
    window.__avatarStatus = { loaded: false, frames: 0 };
    const gl = this.canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      antialias: true,
    });
    if (!gl) throw new Error('WebGL을 초기화할 수 없습니다.');
    this.gl = gl;
    if (!CubismFramework.isStarted()) CubismFramework.startUp();
    if (!CubismFramework.isInitialized()) CubismFramework.initialize();
    this.runtime = new CubismUserModel() as Runtime;
    const manifest = (await this.json(this.inventory.url)) as Manifest;
    const refs = manifest.FileReferences;
    this.runtime.loadModel(await this.buffer(refs.Moc), true);
    this.model = this.runtime.getModel();
    if (!this.model) throw new Error('Cubism Core와 모델 버전을 확인하세요.');
    for (let i = 0; i < this.model.getParameterCount(); i++) {
      const handle = this.model.getParameterId(i) as { getString(): string };
      const id = handle.getString();
      if (typeof id !== 'string' || !id || this.indexes.has(id))
        throw new Error('모델 파라미터 식별자를 확인할 수 없습니다.');
      this.indexes.set(id, i);
    }
    if (refs.Physics) {
      const buffer = await this.buffer(refs.Physics);
      this.runtime.loadPhysics(buffer, buffer.byteLength);
    }
    this.blinkIds = manifest.Groups?.find((group) => group.Name === 'EyeBlink')?.Ids ?? [];
    this.resize();
    this.runtime.getModelMatrix().setHeight(1.82);
    this.runtime.createRenderer(this.canvas.width, this.canvas.height);
    const renderer = this.runtime.getRenderer();
    renderer.startUp(gl);
    renderer.setIsPremultipliedAlpha(true);
    renderer.loadShaders('app://runtime/shaders/');
    await Promise.all(
      refs.Textures.map(async (file, index) => {
        const response = await fetch(new URL(file, this.inventory.url));
        if (!response.ok) throw new Error('모델 텍스처를 읽을 수 없습니다.');
        const bitmap = await createImageBitmap(await response.blob(), {
          premultiplyAlpha: 'premultiply',
        });
        const texture = gl.createTexture();
        if (!texture) throw new Error('GPU 텍스처 할당 실패');
        this.textures.push(texture);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
        bitmap.close();
        renderer.bindTexture(index, texture);
      }),
    );
    for (const entry of refs.Expressions ?? []) {
      const data = (await this.json(new URL(entry.File, this.inventory.url).href)) as {
        Parameters?: Array<{ Id: string; Value: number; Blend: ExpressionParameter['blend'] }>;
      };
      this.expressions.set(
        entry.Name,
        (data.Parameters ?? []).flatMap((p) => {
          const index = this.indexes.get(p.Id);
          return index !== undefined &&
            Number.isFinite(p.Value) &&
            ['Add', 'Multiply', 'Overwrite'].includes(p.Blend)
            ? [{ index, value: p.Value, blend: p.Blend }]
            : [];
        }),
      );
    }
    for (const [group, entries] of Object.entries(refs.Motions ?? {}))
      for (const entry of entries) {
        const name = entry.File.split('/')
          .pop()!
          .replace(/\.motion3\.json$/i, '');
        const buffer = await this.buffer(entry.File);
        const motion = this.runtime.loadMotion(buffer, buffer.byteLength, name);
        if (!motion) continue;
        motion.setEffectIds(
          this.blinkIds.map((id) => CubismFramework.getIdManager().getId(id)),
          [],
        );
        motion.setLoop(group.toLowerCase() === 'idle');
        motion.setFadeInTime(0.35);
        motion.setFadeOutTime(0.35);
        this.motions.set(name, motion);
        if (group.toLowerCase() === 'idle' && !this.idle) {
          this.idle = motion;
          motion.setLoop(true);
        }
      }
    this.model.saveParameters();
    window.__avatarStatus = { loaded: true, frames: 0, parameters: this.model.getParameterCount() };
    this.frame = requestAnimationFrame(this.draw);
    window.addEventListener('resize', this.resize);
    this.canvas.addEventListener('webglcontextlost', this.contextLost);
  }
  setState(state: string): void {
    this.state = state;
    if (state !== 'idle') this.reset();
  }
  reset(): void {
    this.expression = [];
    this.expressionUntil = 0;
    this.motionManager.stopAllMotions();
  }
  cue(cue: CharacterCue): void {
    const name = this.inventory.expressionMap[cue.emotion];
    this.expression = name ? (this.expressions.get(name) ?? []) : [];
    this.expressionStarted = performance.now();
    this.expressionUntil = this.expressionStarted + 4200;
    const motionName = this.inventory.gestureMap[cue.gesture];
    const motion = motionName ? this.motions.get(motionName) : undefined;
    if (motion && performance.now() - this.lastGesture > 1600) {
      this.motionManager.stopAllMotions();
      this.motionManager.startMotionPriority(motion, false, 3);
      this.lastGesture = performance.now();
    }
    if (window.__avatarStatus) {
      window.__avatarStatus.lastCue = `${cue.emotion}/${cue.gesture}`;
      window.__avatarStatus.lastExpression = name ?? 'neutral';
      window.__avatarStatus.lastMotion = motionName ?? 'none';
    }
  }
  hit(x: number, y: number): boolean {
    if (!this.gl || !this.model) return false;
    const rect = this.canvas.getBoundingClientRect();
    const px = Math.floor((x / rect.width) * this.canvas.width);
    const py = Math.floor(((rect.height - y) / rect.height) * this.canvas.height);
    if (px < 0 || py < 0 || px >= this.canvas.width || py >= this.canvas.height) return false;
    const pixel = new Uint8Array(4);
    this.gl.readPixels(px, py, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixel);
    return (pixel[3] ?? 0) > 16;
  }
  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    window.removeEventListener('resize', this.resize);
    this.canvas.removeEventListener('webglcontextlost', this.contextLost);
    for (const texture of this.textures) this.gl?.deleteTexture(texture);
    this.runtime?.release();
  }
  private contextLost = (event: Event): void => {
    event.preventDefault();
    this.disposed = true;
    if (window.__avatarStatus)
      window.__avatarStatus = {
        ...window.__avatarStatus,
        loaded: false,
        error: 'GPU 연결이 끊겼습니다. 앱을 다시 열어 주세요.',
      };
  };
  private resize = (): void => {
    const ratio = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = Math.round(innerWidth * ratio);
    this.canvas.height = Math.round(innerHeight * ratio);
  };
  private draw = (now: number): void => {
    if (this.disposed) return;
    try {
      const dt = this.previous ? Math.min((now - this.previous) / 1000, 0.05) : 0;
      this.previous = now;
      this.model.loadParameters();
      if (this.motionManager.isFinished() && this.idle)
        this.motionManager.startMotionPriority(this.idle, false, 1);
      this.motionManager.updateMotion(this.model, dt);
      const phase = now / 1000;
      const blinkPhase = phase % 4.4;
      const blink = blinkPhase < 0.18 ? Math.abs(blinkPhase / 0.09 - 1) : 1;
      for (const id of this.blinkIds) {
        const index = this.indexes.get(id);
        if (index !== undefined) this.model.setParameterValueByIndex(index, blink);
      }
      const breath = this.indexes.get('ParamBreath');
      if (breath !== undefined)
        this.model.setParameterValueByIndex(breath, 0.5 + Math.sin(phase * 1.8) * 0.35);
      if (this.state === 'thinking' || this.state === 'working') {
        const angle = this.indexes.get('ParamAngleZ');
        if (angle !== undefined)
          this.model.setParameterValueByIndex(angle, Math.sin(phase * 1.4) * 3, 0.35);
      }
      this.runtime._physics?.evaluate(this.model, dt);
      const weight = Math.min(
        1,
        (now - this.expressionStarted) / 200,
        Math.max(0, (this.expressionUntil - now) / 400),
      );
      for (const parameter of this.expression) {
        const current = this.model.getParameterValueByIndex(parameter.index);
        const target =
          parameter.blend === 'Add'
            ? current + parameter.value
            : parameter.blend === 'Multiply'
              ? current * parameter.value
              : parameter.value;
        this.model.setParameterValueByIndex(parameter.index, target, Math.max(0, weight));
      }
      this.model.update();
      const gl = this.gl;
      if (window.__avatarStatus) {
        window.__avatarStatus.expressionActive = weight > 0 && this.expression.length > 0;
        window.__avatarStatus.expressionWeight = Math.max(0, weight);
        window.__avatarStatus.motionActive = this.motionManager.getCurrentPriority() === 3;
      }
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const matrix = new CubismMatrix44();
      matrix.scale(this.canvas.height / this.canvas.width, 1);
      matrix.multiplyByMatrix(this.runtime.getModelMatrix());
      const renderer = this.runtime.getRenderer();
      renderer.setMvpMatrix(matrix);
      renderer.setRenderState(null, [0, 0, this.canvas.width, this.canvas.height]);
      renderer.drawModel();
      if (window.__avatarStatus) window.__avatarStatus.frames++;
      this.frame = requestAnimationFrame(this.draw);
    } catch {
      window.__avatarStatus = {
        loaded: false,
        frames: window.__avatarStatus?.frames ?? 0,
        error: '모델 렌더링 중 오류가 발생했습니다.',
      };
    }
  };
  private async buffer(file: string): Promise<ArrayBuffer> {
    const response = await fetch(new URL(file, this.inventory.url));
    if (!response.ok) throw new Error('모델 자산을 읽을 수 없습니다.');
    return response.arrayBuffer();
  }
  private async json(url: string): Promise<unknown> {
    const response = await fetch(url);
    if (!response.ok) throw new Error('모델 설정을 읽을 수 없습니다.');
    return response.json();
  }
}
