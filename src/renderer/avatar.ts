import { CubismFramework } from '@cubism/live2dcubismframework';
import { CubismUserModel } from '@cubism/model/cubismusermodel';
import { CubismMotionManager } from '@cubism/motion/cubismmotionmanager';
import { CubismMatrix44 } from '@cubism/math/cubismmatrix44';
import { CubismClippingManager_WebGL } from '@cubism/rendering/cubismrenderer_webgl';
import {
  DEFAULT_PRESENTATION,
  type CharacterCue,
  type CharacterPreview,
  type ModelInventory,
  type OverlayInputRegion,
  type PresentationSettings,
} from '../shared/contracts.js';
import { ActingController, reactionDuration, type ActingState } from './acting.js';
import { SURPRISED_EXPRESSION, THINKING_MOTION } from '../shared/model-mappings.js';
import {
  actingChannels,
  expressionValues,
  ExpressionMixer,
  parameterValue,
  surprisedExpression,
  facialValues,
  motionEndpoints,
  PoseSequence,
  type ActingChannel,
  type ExpressionParameter,
  type ParameterRange,
  type PoseDefinition,
} from './performance.js';
import { canGenerateMipmaps, canvasDimensions, maskBufferCountForGroups } from './rendering.js';
import { alphaInputRegion } from '../shared/input-region.js';

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
  getParameterMinimumValue(index: number): number;
  getParameterMaximumValue(index: number): number;
  getParameterDefaultValue(index: number): number;
  getCanvasWidth(): number;
  getCanvasHeight(): number;
}
interface Runtime {
  loadModel(buffer: ArrayBuffer, consistency: boolean): void;
  loadPhysics(buffer: ArrayBuffer, size: number): void;
  loadMotion(buffer: ArrayBuffer, size: number, name: string): Motion;
  getModel(): Model;
  getModelMatrix(): { setHeight(height: number): void; getArray(): Float32Array };
  createRenderer(width: number, height: number, maskBufferCount: number): void;
  getRenderer(): {
    startUp(gl: WebGLRenderingContext): void;
    bindTexture(index: number, texture: WebGLTexture): void;
    setIsPremultipliedAlpha(value: boolean): void;
    setMvpMatrix(matrix: unknown): void;
    setRenderState(fbo: WebGLFramebuffer | null, viewport: number[]): void;
    loadShaders(path: string): void;
    setClippingMaskBufferSize(size: number): void;
    drawModel(): void;
  };
  _physics?: { evaluate(model: Model, dt: number): void };
  release(): void;
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

const FRAMING = {
  full: { scale: 1, y: 0 },
  bust: { scale: 2.1, y: -0.8 },
  close: { scale: 3.2, y: -1.7 },
} as const;

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
  private gestureManager = new CubismMotionManager();
  private actor = new ActingController();
  private mixer = new ExpressionMixer();
  private poses = new PoseSequence();
  private poseDefinitions = new Map<string, PoseDefinition>();
  private motionInfo = new Map<
    string,
    { duration: number; parameters: Set<string>; held: Map<string, number> }
  >();
  private activeGesture = '';
  private stateGesture = false;
  private posePhase = 'none';
  private poseTime = 0;
  private ranges = new Map<string, ParameterRange>();
  private channels: Partial<Record<ActingChannel, ParameterRange>> = {};
  private physicsOutputs = new Set<string>();
  private presentation: PresentationSettings = { ...DEFAULT_PRESENTATION };
  private framing = { scale: 1, y: 0 };
  private errorUntil = 0;
  private lastGesture = -Infinity;
  private lastGestureName = '';
  private previous = 0;
  private frame = 0;
  private disposed = false;
  private state = 'idle';
  onInputRegion?: (region: OverlayInputRegion | null) => void;
  private regionAt = -Infinity;
  private regionPixels = new Uint8Array();
  private regionReady = false;
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
      const min = this.model.getParameterMinimumValue(i);
      const max = this.model.getParameterMaximumValue(i);
      const neutral = this.model.getParameterDefaultValue(i);
      if ([min, max, neutral].every(Number.isFinite) && max >= min)
        this.ranges.set(id, { index: i, min, max, neutral });
    }
    const physicsOutputs = this.physicsOutputs;
    if (refs.Physics) {
      const buffer = await this.buffer(refs.Physics);
      const physics = JSON.parse(new TextDecoder().decode(buffer)) as {
        PhysicsSettings?: Array<{ Output?: Array<{ Destination: { Id: string } }> }>;
      };
      for (const setting of physics.PhysicsSettings ?? [])
        for (const output of setting.Output ?? []) physicsOutputs.add(output.Destination.Id);
      this.runtime.loadPhysics(buffer, buffer.byteLength);
    }
    this.channels = actingChannels(this.ranges, physicsOutputs);
    this.expressions.set(SURPRISED_EXPRESSION, surprisedExpression(this.ranges, physicsOutputs));
    this.blinkIds = manifest.Groups?.find((group) => group.Name === 'EyeBlink')?.Ids ?? [];
    this.resize();
    this.runtime.getModelMatrix().setHeight(1.82);
    // Let the SDK deduplicate masks using its own group identity rules.
    // A single buffer silently overlaps groups once its 36-group limit is exceeded.
    const clipping = new CubismClippingManager_WebGL();
    clipping.initializeForDrawable(this.model, 1);
    const maskGroups = clipping.getClippingMaskCount() as number;
    clipping.release();
    const maskBuffers = maskBufferCountForGroups(maskGroups);
    this.runtime.createRenderer(this.canvas.width, this.canvas.height, maskBuffers);
    const renderer = this.runtime.getRenderer();
    renderer.setClippingMaskBufferSize(512);
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
        // WebGL 1 only permits mipmaps for power-of-two textures.
        if (canGenerateMipmaps(bitmap.width, bitmap.height)) {
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        }
        gl.bindTexture(gl.TEXTURE_2D, null);
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
        const data = JSON.parse(new TextDecoder().decode(buffer)) as {
          Meta?: { Duration?: number };
          Curves?: Array<{ Target: string; Id: string; Segments?: number[] }>;
        };
        this.motionInfo.set(name, {
          duration: Math.max(0, data.Meta?.Duration ?? 0) * 1000,
          held: motionEndpoints(data.Curves ?? []),
          parameters: new Set(
            (data.Curves ?? [])
              .filter((curve) => curve.Target === 'Parameter')
              .map((curve) => curve.Id),
          ),
        });
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
    for (const [enter, exit, parameter] of [
      ['默认手切举手', '举手切默认手', 'Movement2'],
      ['竖手指切出来动画', '竖手指切回默认', 'Movement3'],
      ['狗尾草切换出来', '狗尾草切回默认手', 'Movement1'],
    ]) {
      if (!enter || !exit || !parameter || !this.ranges.has(parameter)) continue;
      const entry = this.motionInfo.get(enter),
        back = this.motionInfo.get(exit);
      if (!entry?.duration || !back?.duration) continue;
      this.poseDefinitions.set(enter, {
        enter,
        exit,
        parameter,
        enterMs: entry.duration,
        exitMs: back.duration,
      });
      // These clips are authored as a pair. Preserve their final pose until the return clip.
      for (const name of [enter, exit]) {
        this.motions.get(name)?.setFadeInTime(0);
        this.motions.get(name)?.setFadeOutTime(0);
      }
    }
    this.model.saveParameters();
    window.__avatarStatus = {
      loaded: true,
      frames: 0,
      parameters: this.model.getParameterCount(),
      maskGroups,
      maskBuffers,
    };
    this.frame = requestAnimationFrame(this.draw);
    window.addEventListener('resize', this.resize);
    this.canvas.addEventListener('webglcontextlost', this.contextLost);
  }
  configure(settings: PresentationSettings): void {
    this.presentation = { ...settings };
    this.actor.configure(settings);
    if (settings.reducedMotion) this.clearPose();
    if (!this.model || settings.reducedMotion) this.framing = { ...FRAMING[settings.framing] };
  }
  setState(state: string): void {
    const now = performance.now();
    const next: ActingState = ['thinking', 'working', 'error', 'blocked'].includes(state)
      ? (state as ActingState)
      : 'idle';
    const changed = next !== this.state;
    const reacting =
      this.actor.sample(now, 0).active ||
      (!this.stateGesture &&
        (this.poses.sample(now).phase !== 'none' ||
          (!!this.activeGesture && !this.gestureManager.isFinished())));
    if (changed && (this.stateGesture || next === 'error' || next === 'blocked' || !reacting)) {
      this.mixer.clear(now, next === 'blocked');
      this.clearPose();
    }
    this.state = next;
    this.errorUntil = next === 'error' ? now + 3000 : 0;
    this.actor.setState(next, now);
    if (changed && next === 'thinking' && !reacting) {
      this.startGesture(this.inventory.gestureMap.thinking, now);
      this.stateGesture = !!this.activeGesture || this.poses.sample(now).phase !== 'none';
    }
  }
  reset(): void {
    const now = performance.now();
    this.actor.reset(now);
    this.lastGesture = -Infinity;
    this.lastGestureName = '';
    this.state = 'idle';
    this.mixer.clear(now, true);
    this.clearPose();
  }
  preview(preset: CharacterPreview): void {
    if (this.state === 'blocked') return;
    const now = performance.now();
    this.reset();
    this.actor.preview(preset, now);
    if (preset !== 'reset') {
      const emotion =
        preset === 'shy'
          ? 'embarrassed'
          : preset === 'happy'
            ? 'happy'
            : preset === 'surprised'
              ? 'surprised'
              : 'neutral';
      const name =
        preset === 'heart' && this.expressions.has('爱心眼')
          ? '爱心眼'
          : preset === 'tease' && this.expressions.has('屑屑眼')
            ? '屑屑眼'
            : this.inventory.expressionMap[emotion];
      this.setExpression(name, now, reactionDuration(preset));
      const motion =
        preset === 'grass'
          ? '狗尾草切换出来'
          : preset === 'thinking'
            ? this.inventory.gestureMap.thinking
            : preset === 'explain'
              ? this.inventory.gestureMap.explain
              : undefined;
      this.startGesture(motion, now);
    }
    if (window.__avatarStatus) window.__avatarStatus.lastPreview = preset;
  }
  cue(cue: CharacterCue): void {
    const now = performance.now();
    if (!this.actor.cue(cue, now)) return;
    // A configured waiting clip must not keep owning head/hand channels or
    // consume the cooldown of the actual message gesture.
    if (this.stateGesture) {
      this.clearPose();
      this.lastGesture = -Infinity;
      this.lastGestureName = '';
    }
    const emotion = cue.attitude === 'shy' ? 'embarrassed' : cue.emotion;
    const name =
      cue.attitude === 'tease' &&
      this.actor.sample(now, 0).variant === 0 &&
      this.expressions.has('屑屑眼')
        ? '屑屑眼'
        : this.inventory.expressionMap[emotion];
    this.setExpression(name, now, reactionDuration(this.actor.sample(now, 0).preset));
    // Delivery tone does not override an explicit "no physical gesture" decision.
    const motionName = this.inventory.gestureMap[cue.gesture];
    this.startGesture(motionName, now);
    if (window.__avatarStatus) {
      window.__avatarStatus.lastCue = `${cue.emotion}/${cue.gesture}`;
      window.__avatarStatus.lastSegmentId = cue.segmentId;
      window.__avatarStatus.lastAttitude = cue.attitude ?? 'neutral';
      window.__avatarStatus.lastExpression = name ?? 'neutral';
      window.__avatarStatus.lastMotion = motionName ?? 'none';
    }
  }
  private setExpression(name: string | undefined, now: number, holdMs: number): void {
    this.mixer.transition(
      name ?? 'neutral',
      name ? (this.expressions.get(name) ?? []) : [],
      now,
      holdMs,
    );
  }
  private clearPose(): void {
    this.stateGesture = false;
    this.poses.clear();
    this.gestureManager.stopAllMotions();
    this.activeGesture = '';
    this.posePhase = 'none';
    this.poseTime = 0;
  }
  private startGesture(name: string | undefined, now: number): void {
    if (window.__avatarStatus) window.__avatarStatus.lastMotion = name ?? 'none';
    if (name === THINKING_MOTION) return; // Thinking gaze/head motion is driven by the local actor.
    if (!name || this.presentation.reducedMotion || now - this.lastGesture < 1600) return;
    if (name === this.lastGestureName && now - this.lastGesture < 6200) return;
    const motion = this.motions.get(name);
    if (!motion) return;
    const definition = this.poseDefinitions.get(name);
    if (definition) {
      if (!this.poses.start(definition, now)) return;
      this.posePhase = 'none';
    } else {
      this.poses.clear();
      this.posePhase = 'none';
      this.poseTime = 0;
      this.gestureManager.startMotionPriority(motion, false, 3);
      this.activeGesture = name;
    }
    this.lastGesture = now;
    this.lastGestureName = name;
  }
  private write(index: number, value: number): void {
    const min = this.model.getParameterMinimumValue(index);
    const max = this.model.getParameterMaximumValue(index);
    if (Number.isFinite(value))
      this.model.setParameterValueByIndex(index, Math.max(min, Math.min(max, value)));
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
    this.onInputRegion?.(null);
    if (window.__avatarStatus)
      window.__avatarStatus = {
        ...window.__avatarStatus,
        loaded: false,
        error: 'GPU 연결이 끊겼습니다. 앱을 다시 열어 주세요.',
      };
  };
  private resize = (): void => {
    const size = canvasDimensions(
      innerWidth,
      innerHeight,
      window.devicePixelRatio,
      this.gl.getParameter(this.gl.MAX_RENDERBUFFER_SIZE) as number,
    );
    this.canvas.width = size.width;
    this.canvas.height = size.height;
  };
  private draw = (now: number): void => {
    if (this.disposed) return;
    try {
      const elapsed = this.previous ? Math.max(0, (now - this.previous) / 1000) : 0;
      const dt = Math.min(elapsed, 0.05);
      this.previous = now;
      this.model.loadParameters();
      if (this.motionManager.isFinished() && this.idle)
        this.motionManager.startMotionPriority(this.idle, false, 1);
      this.motionManager.updateMotion(this.model, elapsed);
      if (this.errorUntil && now >= this.errorUntil) this.setState('idle');
      const pose = this.poses.sample(now);
      if (pose.phase !== this.posePhase) {
        this.gestureManager.stopAllMotions();
        this.poseTime = 0;
        if (pose.definition && (pose.phase === 'enter' || pose.phase === 'exit')) {
          const name = pose.phase === 'enter' ? pose.definition.enter : pose.definition.exit;
          this.gestureManager.startMotionPriority(this.motions.get(name), false, 3);
          this.activeGesture = name;
          this.gestureManager.updateMotion(this.model, 0);
        } else if (pose.phase === 'none') this.activeGesture = '';
        this.posePhase = pose.phase;
      }
      if (pose.definition && (pose.phase === 'hold' || pose.phase === 'exit')) {
        for (const [id, value] of this.motionInfo.get(pose.definition.enter)?.held ?? []) {
          const index = this.indexes.get(id);
          if (index !== undefined) this.write(index, value);
        }
      }
      if (pose.phase === 'enter' || pose.phase === 'exit') {
        const time = (pose.timeMs ?? 0) / 1000;
        this.gestureManager.updateMotion(this.model, Math.max(0, time - this.poseTime));
        this.poseTime = time;
      } else if (pose.phase === 'none') this.gestureManager.updateMotion(this.model, elapsed);
      if (pose.phase === 'none' && this.gestureManager.isFinished()) this.activeGesture = '';
      if (this.stateGesture && pose.phase === 'none' && !this.activeGesture) {
        this.stateGesture = false;
        this.lastGesture = -Infinity;
        this.lastGestureName = '';
      }
      const acting = this.actor.sample(now, dt);
      const animated = this.motionInfo.get(this.activeGesture)?.parameters;
      for (const [channel, range] of Object.entries(this.channels) as [
        ActingChannel,
        ParameterRange,
      ][]) {
        const id = this.model.getParameterId(range.index) as { getString(): string };
        if (animated?.has(id.getString())) continue;
        // DeepSeek forward lean is the negative half of LeanInput's authored range.
        const amount = channel === 'lean' ? -acting.lean * 0.35 : acting[channel];
        const target = parameterValue(range, amount);
        if (channel === 'smile') {
          const base = this.model.getParameterValueByIndex(range.index);
          this.write(range.index, base + (target - range.neutral));
        } else this.write(range.index, target);
      }
      for (const id of this.blinkIds) {
        const index = this.indexes.get(id);
        if (index !== undefined && !animated?.has(id) && !this.physicsOutputs.has(id))
          this.write(index, (this.ranges.get(id)?.neutral ?? 1) * acting.blink);
      }
      const layers = this.mixer.sample(now);
      // Special eye artwork owns its shape. Do not add a competing procedural wink.
      const specialEyes = layers.some(
        (layer) =>
          layer.weight > 0.01 &&
          layer.parameters.some(
            (p) =>
              ['key3', 'key4', 'key5', 'key6'].some((id) => this.indexes.get(id) === p.index) &&
              p.value > 0,
          ),
      );
      const face = specialEyes
        ? { ...acting, eyeL: acting.blink, eyeR: acting.blink, eyeSmile: 0 }
        : acting;
      for (const [index, value] of facialValues(face, this.ranges, this.physicsOutputs, animated))
        this.write(index, value);
      const breath = this.ranges.get('ParamBreath');
      if (breath && this.state !== 'blocked' && !animated?.has('ParamBreath'))
        this.write(breath.index, breath.min + (breath.max - breath.min) * acting.breath);
      const values = expressionValues(layers, (index) =>
        this.model.getParameterValueByIndex(index),
      );
      for (const [index, value] of values) this.write(index, value);
      // Facial expressions contain physics inputs too (brows, cheeks, eyes).
      this.runtime._physics?.evaluate(this.model, dt);
      const weight = Math.min(
        1,
        layers.reduce((sum, layer) => sum + layer.weight, 0),
      );
      this.model.update();
      const gl = this.gl;
      if (window.__avatarStatus) {
        window.__avatarStatus.expressionActive = weight > 0;
        window.__avatarStatus.expressionWeight = Math.max(0, weight);
        window.__avatarStatus.actingPreset = acting.preset;
        window.__avatarStatus.reactionPhase = acting.phase;
        window.__avatarStatus.variant = acting.variant;
        window.__avatarStatus.posePhase = pose.phase;
        window.__avatarStatus.motionActive =
          pose.phase !== 'none' ||
          !!this.activeGesture ||
          ((acting.preset === 'thinking' || acting.gesture === 'thinking') &&
            this.inventory.gestureMap.thinking === THINKING_MOTION);
      }
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const matrix = new CubismMatrix44();
      const desired = FRAMING[this.presentation.framing];
      const blend = 1 - Math.exp(-6 * dt);
      this.framing.scale += (desired.scale - this.framing.scale) * blend;
      this.framing.y += (desired.y - this.framing.y) * blend;
      const approach = this.presentation.reducedMotion ? 0 : Math.max(0, acting.lean) * 0.25;
      const scale = this.framing.scale * (1 + approach);
      matrix.scale((this.canvas.height / this.canvas.width) * scale, scale);
      matrix.translateY(this.framing.y + acting.offsetY - (scale - this.framing.scale) * 0.7);
      matrix.multiplyByMatrix(this.runtime.getModelMatrix());
      const renderer = this.runtime.getRenderer();
      renderer.setMvpMatrix(matrix);
      renderer.setRenderState(null, [0, 0, this.canvas.width, this.canvas.height]);
      renderer.drawModel();
      if (this.onInputRegion && now - this.regionAt >= 100) {
        this.regionAt = now;
        const width = this.canvas.width,
          height = this.canvas.height;
        if (
          width <= 0 ||
          height <= 0 ||
          width > 8192 ||
          height > 8192 ||
          width * height > 16_777_216 ||
          innerWidth > 8192 ||
          innerHeight > 8192
        ) {
          this.onInputRegion(null);
        } else {
          if (this.regionPixels.length !== width * height * 4)
            this.regionPixels = new Uint8Array(width * height * 4);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, this.regionPixels);
          const region = alphaInputRegion(
            this.regionPixels,
            width,
            height,
            innerWidth,
            innerHeight,
          );
          if (region.rects.length || this.regionReady) {
            this.regionReady = true;
            this.onInputRegion(region);
          }
        }
      }
      if (window.__avatarStatus) window.__avatarStatus.frames++;
      this.frame = requestAnimationFrame(this.draw);
    } catch {
      this.onInputRegion?.(null);
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
