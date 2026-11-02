import { Avatar } from '../../src/renderer/avatar';
import { ActingController } from '../../src/renderer/acting';

// This fixture uses the real renderer/SDK with a deterministic local animation clock.
window.requestAnimationFrame = () => 0;
// Ozone headless can expose a 1×1 hidden-window viewport; fix only this fixture's canvas viewport.
Object.defineProperty(window, 'innerWidth', { value: 360 });
Object.defineProperty(window, 'innerHeight', { value: 560 });
Object.defineProperty(window, 'devicePixelRatio', { value: 1 });
let clock = 1000;
Object.defineProperty(performance, 'now', { value: () => clock });
let avatar: any;
let inventory: any;
let defaultWave: string | undefined;
let render = true;
let beforePhysics: Record<string, number> = {};
const parameters = [
  'LeanInput',
  'AngleX',
  'AngleY',
  'AngleZ',
  'PositionX',
  'PositionZ',
  'ParamBodyAngleZ',
  'ParamBodyAngleX',
  'Param50',
  'ParamAngleY',
  'ParamAngleX',
  'ParamAngleZ',
  'ParamEyeBallX',
  'ParamEyeBallY',
  'EyeSmile',
  'ParamEyeLOpen',
  'ParamEyeROpen',
  'ParamMouthForm',
  'ParamMouthOpenY',
  'ParamBrowLY',
  'ParamBrowRY',
  'Mouthpucker',
  'Movement2',
  'Param56',
  'Param57',
  'Movement3',
  'Param62',
  'Param59',
  'Param60',
  'Param61',
  'Param36',
  'Param41',
  'Param42',
  'key2',
  'key3',
  'key4',
  'key5',
  'key6',
  'key7',
  'key13',
];
const values = (): Record<string, number> =>
  Object.fromEntries(
    parameters
      .filter((id) => avatar.indexes.has(id))
      .map((id) => [id, avatar.model.getParameterValueByIndex(avatar.indexes.get(id))]),
  );
const read = (): any => {
  const errors = [];
  for (let i = 0; i < avatar.model.getParameterCount(); i++) {
    const value = avatar.model.getParameterValueByIndex(i);
    if (
      !Number.isFinite(value) ||
      value < avatar.model.getParameterMinimumValue(i) - 1e-5 ||
      value > avatar.model.getParameterMaximumValue(i) + 1e-5
    )
      errors.push(i);
  }
  const gl = avatar.gl;
  const pixels = new Uint8Array(avatar.canvas.width * avatar.canvas.height * 4);
  gl.readPixels(0, 0, avatar.canvas.width, avatar.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let opaquePixels = 0;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) opaquePixels++;
  const head = avatar.pettingRegion;
  return {
    status: { ...window.__avatarStatus },
    dimensions: [innerWidth, innerHeight, avatar.canvas.width, avatar.canvas.height],
    values: values(),
    beforePhysics,
    renderMatrix: Array.from(avatar.runtime.getRenderer().getMvpMatrix().getArray()),
    frame: avatar.actor.sample(clock, 0),
    gazeSlotId: avatar.actor.gazeSlotId,
    pose: avatar.poses.sample(clock),
    petting: {
      weight: avatar.petting.sample(clock),
      poseOwned: !!avatar.petPose,
      region: head,
      headHit: !!head && avatar.pettingHit(head.x + head.width / 2, head.y + head.height / 2),
      lowerHit: avatar.pettingHit(180, 500),
    },
    idleParameters: [
      ...(avatar.motionInfo.get(
        [...avatar.motions].find(([, motion]: any) => motion === avatar.idle)?.[0],
      )?.parameters ?? []),
    ],
    layers: avatar.mixer.sample(clock).map(({ name, weight }: any) => ({ name, weight })),
    rangeErrors: errors,
    opaquePixels,
    handEndpoints: Object.fromEntries(
      [...avatar.poseDefinitions].map(([name, def]: any) => [
        name,
        {
          enter: Object.fromEntries(avatar.motionInfo.get(def.enter).held),
          exit: Object.fromEntries(avatar.motionInfo.get(def.exit).held),
        },
      ]),
    ),
    handValues: Object.fromEntries(
      [
        ...new Set(
          [...avatar.poseDefinitions.values()].flatMap((def: any) => [
            ...avatar.motionInfo.get(def.enter).held.keys(),
          ]),
        ),
      ]
        .filter((id: any) => avatar.indexes.has(id))
        .map((id: any) => [id, avatar.model.getParameterValueByIndex(avatar.indexes.get(id))]),
    ),
  };
};
const api = {
  async setup(input: any) {
    inventory = input;
    defaultWave = inventory.gestureMap.wave;
    avatar = new Avatar(document.querySelector('canvas')!, inventory);
    await avatar.load();
    const renderer = avatar.runtime.getRenderer();
    const drawModel = renderer.drawModel.bind(renderer);
    // Integrate every 50ms, but rasterize only requested acceptance checkpoints.
    renderer.drawModel = () => {
      if (render) drawModel();
    };
    const physics = avatar.runtime._physics;
    if (physics) {
      const evaluate = physics.evaluate.bind(physics);
      physics.evaluate = (model: any, dt: number) => {
        beforePhysics = values();
        evaluate(model, dt);
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { expressions: inventory.expressionMap, gestures: inventory.gestureMap };
  },
  async run(scene: any) {
    avatar.reset();
    // Each named acceptance case starts at the first authored acting variation.
    avatar.actor = new ActingController();
    inventory.expressionMap.happy = scene.savedHappy ? '＞＜' : undefined;
    inventory.gestureMap.wave = scene.emptyWave
      ? undefined
      : scene.customWave
        ? inventory.gestureMap.explain
        : defaultWave;
    avatar.configure({
      intensity: scene.intensity ?? 'normal',
      framing: 'bust',
      positionLocked: false,
      pettingEnabled: !!(scene.petting || scene.pettingAvailable),
      reducedMotion: !!scene.reducedMotion,
    });
    const cue = {
      requestId: scene.name,
      messageId: 'message',
      segmentId: 1,
      emotion: scene.emotion ?? 'neutral',
      attitude: scene.attitude ?? 'neutral',
      gesture: scene.gesture ?? 'none',
      stage: 'semantic',
      confidence: 1,
      source: 'fallback',
    };
    const start = clock;
    if (scene.state) avatar.setState(scene.state);
    if (scene.petting) {
      if (scene.gesture) avatar.cue(cue);
      avatar.beginPetting();
    } else if (scene.preview) avatar.preview(scene.preview);
    else if (!scene.idle) avatar.cue(cue);
    const samples = [];
    let cleared = false;
    let stateChanged = false;
    let petEnded = false;
    let contactHeld = !!scene.petting;
    let petEventIndex = 0;
    let lastPetPoint: { x: number; y: number } | undefined;
    for (const time of scene.times) {
      const target = start + time;
      while (clock < target) {
        clock = Math.min(target, clock + 50);
        if (scene.clearAt !== undefined && !cleared && clock - start >= scene.clearAt) {
          avatar.clearCue(cue);
          cleared = true;
        }
        if (
          !stateChanged &&
          scene.stateChangeAt !== undefined &&
          clock - start >= scene.stateChangeAt
        ) {
          avatar.setState(scene.stateChange ?? 'blocked');
          stateChanged = true;
        }
        if (
          (scene.petting || scene.pettingAvailable) &&
          contactHeld &&
          clock - start >= (scene.strokeFromMs ?? 0) &&
          clock - start <= (scene.strokeUntilMs ?? 600)
        ) {
          const region = avatar.pettingRegion;
          if (scene.handContact && region) {
            const point = {
              x: region.x + region.width * 0.5 + Math.sin((clock - start) / 100) * 20,
              y: region.y + region.height * 0.5,
            };
            if (!avatar.pettingHit(point.x, point.y))
              throw Error(`Petting acceptance point outside own alpha at ${clock - start}`);
            const distance = lastPetPoint
              ? Math.hypot(point.x - lastPetPoint.x, point.y - lastPetPoint.y)
              : 0;
            avatar.strokePetting(distance, point.x, point.y);
            lastPetPoint = point;
          } else if (scene.focusDirection && region && clock - start > 500)
            avatar.strokePetting(
              12,
              region.x + region.width * (0.5 + 0.25 * scene.focusDirection),
              region.y + region.height * 0.5,
            );
          else avatar.strokePetting(12);
        }
        if (
          scene.petting &&
          !scene.noPointerUp &&
          !petEnded &&
          clock - start >= (scene.endAtMs ?? 650)
        ) {
          avatar.endPetting();
          petEnded = true;
          contactHeld = false;
        }
        while (scene.pettingActions?.[petEventIndex]?.at <= clock - start) {
          const event = scene.pettingActions[petEventIndex++];
          if (event.type === 'begin') {
            if (!avatar.beginPetting()) throw Error('Local contact begin rejected');
            contactHeld = true;
            lastPetPoint = undefined;
          } else {
            avatar.endPetting();
            contactHeld = false;
          }
        }
        render =
          (!!scene.handContact && clock - start >= Math.max(0, (scene.strokeFromMs ?? 0) - 50)) ||
          clock === target;
        if (render) avatar.regionAt = -Infinity;
        avatar.draw(clock);
      }
      samples.push({ time, ...read(), png: avatar.canvas.toDataURL('image/png') });
    }
    return samples;
  },
};
(window as any).expressionAcceptance = api;
