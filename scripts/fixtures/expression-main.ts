import { app, BrowserWindow, protocol, net, session } from 'electron';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { ModelLibrary } from '../../src/main/model-library';

const arg = (name: string): string => process.argv[process.argv.indexOf(name) + 1]!;
const root = arg('--root'),
  output = arg('--output'),
  build = join(output, 'build');
app.setPath('userData', join(output, 'profile'));
app.setPath('sessionData', join(output, 'session'));
app.commandLine.appendSwitch('use-gl', 'angle');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

const leanScenes = [
  { name: 'lean-happy', emotion: 'happy', times: [1000] },
  { name: 'lean-tease', attitude: 'tease', times: [1000] },
  { name: 'lean-sad', emotion: 'sad', times: [1000] },
];
const ownedLeanScenes = [
  { name: 'owned-confused', emotion: 'confused', intensity: 'expressive', times: [1000, 3000] },
  {
    name: 'owned-confused-reduced',
    emotion: 'confused',
    intensity: 'expressive',
    reducedMotion: true,
    times: [1000, 3000],
  },
];
// The configured actor supplies rare idle edges; acceptance uses no guessed cadence.
let idleFaceAt = 0;
let idleHandAt = 0;
let idleEdges: number[] = [];
const faceAt = (offset: number): number => idleFaceAt + offset;
const handAt = (offset: number): number => idleHandAt + offset;
let scenes: ReturnType<typeof createScenes>;
const createScenes = () => [
  ...leanScenes,
  { name: 'posture-neutral', idle: true, postureProbe: { lean: 0, approach: 0 }, times: [3000] },
  { name: 'posture-forward', idle: true, postureProbe: { lean: 0.5, approach: 0 }, times: [3000] },
  { name: 'approach-only', idle: true, postureProbe: { lean: 0, approach: 0.5 }, times: [3000] },
  { name: 'idle-life', idle: true, times: [2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000] },
  {
    name: 'idle-life-reduced',
    idle: true,
    reducedMotion: true,
    times: [2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000],
  },
  {
    name: 'idle-attention',
    idle: true,
    intensity: 'expressive',
    times: [
      faceAt(-250),
      faceAt(100),
      faceAt(350),
      faceAt(500),
      faceAt(750),
      faceAt(1200),
      faceAt(1350),
    ],
  },
  {
    name: 'idle-attention-held',
    idle: true,
    intensity: 'expressive',
    pettingAvailable: true,
    strokeFromMs: faceAt(20000),
    strokeUntilMs: faceAt(20000),
    pettingActions: [
      { at: faceAt(-250), type: 'begin' },
      { at: faceAt(450), type: 'end' },
    ],
    times: [faceAt(-250), faceAt(350), faceAt(550), faceAt(1050), faceAt(1350)],
  },
  {
    name: 'idle-attention-residue',
    idle: true,
    intensity: 'expressive',
    pettingAvailable: true,
    strokeFromMs: faceAt(-750),
    strokeUntilMs: faceAt(-450),
    pettingActions: [
      { at: faceAt(-750), type: 'begin' },
      { at: faceAt(-450), type: 'end' },
    ],
    times: [faceAt(-250), faceAt(350), faceAt(650), faceAt(1050), faceAt(1350)],
  },
  {
    name: 'idle-attention-interrupt',
    idle: true,
    intensity: 'expressive',
    pettingAvailable: true,
    strokeFromMs: faceAt(20000),
    strokeUntilMs: faceAt(20000),
    pettingActions: [
      { at: faceAt(450), type: 'begin' },
      { at: faceAt(500), type: 'end' },
    ],
    times: [faceAt(350), faceAt(450), faceAt(500), faceAt(750), faceAt(1350)],
  },
  {
    name: 'idle-attention-approval',
    idle: true,
    intensity: 'expressive',
    stateChangeAt: faceAt(450),
    stateChange: 'blocked',
    times: [faceAt(350), faceAt(450), faceAt(750)],
  },
  {
    name: 'idle-expressive',
    idle: true,
    intensity: 'expressive',
    times: [
      ...new Set([
        6000,
        7400,
        9500,
        faceAt(350),
        faceAt(1400),
        handAt(-350),
        handAt(-100),
        handAt(1150),
        handAt(1500),
        handAt(2200),
        handAt(2750),
        handAt(2800),
        handAt(4000),
        ...idleEdges.map((time) => time + 350),
      ]),
    ].sort((a, b) => a - b),
  },
  ...[
    { name: 'idle-expressive-reduced', intensity: 'expressive', reducedMotion: true },
    { name: 'idle-expressive-custom', intensity: 'expressive', customWave: true },
    { name: 'idle-expressive-empty', intensity: 'expressive', emptyWave: true },
    { name: 'idle-normal-long', intensity: 'normal' },
    { name: 'idle-quiet-long', intensity: 'quiet' },
    { name: 'idle-working', intensity: 'expressive', state: 'working' },
  ].map((options) => ({
    ...options,
    idle: true,
    times: [6100, faceAt(350), faceAt(1400), handAt(-100), handAt(1500), handAt(2800)],
  })),
  {
    name: 'active-none-expressive',
    emotion: 'happy',
    intensity: 'expressive',
    times: [1000, 3000, 4800, 6100],
  },
  {
    name: 'idle-approval',
    idle: true,
    intensity: 'expressive',
    stateChangeAt: handAt(1250),
    stateChange: 'blocked',
    times: [handAt(1150), handAt(1250), handAt(1650)],
  },
  {
    name: 'idle-contact',
    idle: true,
    intensity: 'expressive',
    pettingAvailable: true,
    handContact: true,
    noPointerUp: true,
    strokeFromMs: handAt(650),
    strokeUntilMs: handAt(3650),
    pettingActions: [
      { at: handAt(650), type: 'begin' },
      { at: handAt(3650), type: 'end' },
    ],
    times: [
      handAt(550),
      handAt(650),
      handAt(1150),
      handAt(1650),
      handAt(2650),
      handAt(2750),
      handAt(3150),
      handAt(3650),
      handAt(4750),
    ],
  },
  ...[
    { name: 'torso-happy', emotion: 'happy', attitude: 'neutral' },
    { name: 'torso-laugh', emotion: 'happy', attitude: 'laugh' },
    { name: 'torso-laugh-reduced', emotion: 'happy', attitude: 'laugh', reducedMotion: true },
    { name: 'torso-shy', emotion: 'embarrassed', attitude: 'laugh' },
    { name: 'torso-angry', emotion: 'angry', attitude: 'neutral' },
    { name: 'torso-shy-reduced', emotion: 'embarrassed', attitude: 'laugh', reducedMotion: true },
  ].map((options) => ({
    ...options,
    intensity: 'expressive',
    times:
      options.name === 'torso-laugh' || options.name === 'torso-laugh-reduced'
        ? [650, 1000, 1200, 1700, 2400, 3000, 4200, 4800, 5600, 6200, 8000]
        : [1000, 3000, 4200, 4800, 5600, 6200, 8000],
  })),
  { name: 'semantic-neutral', times: [1000, 1750, 1800, 3000] },
  {
    name: 'happy',
    emotion: 'happy',
    times: [300, 1000, 2000, 3000, 4200, 4800, 5600, 6150, 6200, 8000],
  },
  {
    name: 'happy-laugh',
    emotion: 'happy',
    attitude: 'laugh',
    times: [300, 1000, 2000, 3000, 3600, 4200, 4800, 5550, 5600, 6200, 8000],
  },
  {
    name: 'embarrassed-laugh',
    emotion: 'embarrassed',
    attitude: 'laugh',
    times: [1000, 3600, 4800, 5550, 5600, 8000],
  },
  {
    name: 'concerned-tease',
    emotion: 'concerned',
    attitude: 'tease',
    times: [300, 700, 1000, 1400, 2000, 3000, 4200, 4800, 5600, 6150, 6200, 8000],
  },
  {
    name: 'explain',
    gesture: 'explain',
    times: [500, 1300, 2000, 2400, 2500, 2800, 2900, 2950, 3500, 4200, 4800, 6200, 8000],
  },
  {
    name: 'wave',
    gesture: 'wave',
    times: [
      500,
      700,
      1050,
      1283,
      1583,
      1883,
      2183,
      2500,
      3183,
      ...Array.from({ length: 20 }, (_, index) => 3200 + index * 50),
      4200,
      4800,
      6200,
      8000,
    ],
  },
  {
    name: 'saved-happy',
    emotion: 'happy',
    attitude: 'laugh',
    savedHappy: true,
    times: [700, 1000, 1400, 4800],
  },
  {
    name: 'saved-joy',
    emotion: 'happy',
    attitude: 'neutral',
    savedHappy: true,
    times: [700, 1500, 2000, 2300, 3000, 4200, 4800, 5600, 6150, 6200, 8000],
  },
  { name: 'clear', emotion: 'happy', gesture: 'explain', clearAt: 2050, times: [2000, 2100] },
  { name: 'clear-afterglow', emotion: 'happy', clearAt: 4850, times: [4800, 4900] },
  {
    name: 'reduced',
    emotion: 'happy',
    gesture: 'explain',
    reducedMotion: true,
    times: [1000, 4200, 4800, 5600, 6150, 6200, 8000],
  },
  {
    name: 'angry',
    emotion: 'angry',
    times: [300, 1000, 2000, 2200, 2600, 3000, 3150, 4200, 4800, 6100, 6150, 6200, 8000],
  },
  {
    name: 'confused',
    emotion: 'confused',
    times: [1000, 1200, 1250, 1600, 3000, 4200, 4800, 5600, 6150, 6200, 8000],
  },
  ...['sad', 'concerned', 'angry', 'confused', 'reassure', 'wave'].map((preview) => ({
    name: `preview-${preview}`,
    preview,
    times:
      preview === 'angry'
        ? [1000, 3900, 4150, 4200]
        : preview === 'wave'
          ? [1000, 2500, 2632, 2633, 2783, 2933, 3650, 4200]
          : [1000],
  })),
  {
    name: 'preview-explain',
    preview: 'explain',
    times: [2200, 2400, 2600, 2749, 2750, 2800, 2900, 3000, 3200, 4199, 4200],
  },
  { name: 'petting', petting: true, times: [500, 1400, 1800] },
  { name: 'petting-left', petting: true, focusDirection: -1, times: [500, 600, 1800] },
  { name: 'petting-right', petting: true, focusDirection: 1, times: [500, 600, 1800] },
  {
    name: 'petting-recontact',
    petting: true,
    handContact: true,
    strokeUntilMs: 3200,
    noPointerUp: true,
    pettingActions: [
      { at: 1600, type: 'end' },
      { at: 1851, type: 'begin' },
      { at: 3200, type: 'end' },
    ],
    times: [1500, 1600, 1850, 1851, 1900, 2500, 2650, 3000, 3200, 4250],
  },
  {
    name: 'petting-recontact-no-stroke',
    petting: true,
    handContact: true,
    strokeUntilMs: 1600,
    noPointerUp: true,
    pettingActions: [
      { at: 1600, type: 'end' },
      { at: 1851, type: 'begin' },
      { at: 1900, type: 'end' },
      { at: 2001, type: 'begin' },
      { at: 2050, type: 'end' },
    ],
    times: [1600, 1850, 1851, 1900, 2001, 2050, 2600, 2650, 2700],
  },
  {
    name: 'petting-scoped-clear',
    petting: true,
    handContact: true,
    emotion: 'happy',
    gesture: 'none',
    clearAt: 1000,
    strokeUntilMs: 2000,
    endAtMs: 2000,
    times: [950, 1000, 1500, 2000, 3050],
  },
  {
    name: 'petting-late-hand',
    petting: true,
    handContact: true,
    strokeFromMs: 10000,
    strokeUntilMs: 11000,
    endAtMs: 11000,
    times: [10000, 11000, 12000],
  },
  {
    name: 'petting-held',
    petting: true,
    handContact: true,
    strokeUntilMs: 3000,
    endAtMs: 3000,
    times: [500, 1500, 2500, 3000, 3500, 4050, 4200],
  },
  {
    name: 'petting-early-release',
    petting: true,
    handContact: true,
    strokeUntilMs: 400,
    endAtMs: 425,
    times: [400, 425, 475, 850, 1475],
  },
  {
    name: 'petting-stationary-hand',
    petting: true,
    handContact: true,
    strokeUntilMs: 1500,
    noPointerUp: true,
    times: [1500, 1650, 1900, 2400, 2600],
  },
  {
    name: 'petting-twelve-second-hand',
    petting: true,
    handContact: true,
    strokeUntilMs: 12000,
    noPointerUp: true,
    times: [4000, 10000, 11000, 11950, 12000, 12050],
  },
  {
    name: 'petting-custom-wave',
    petting: true,
    handContact: true,
    customWave: true,
    strokeUntilMs: 2000,
    endAtMs: 2000,
    times: [1500, 2500],
  },
  {
    name: 'petting-reduced-hand',
    petting: true,
    handContact: true,
    reducedMotion: true,
    strokeUntilMs: 2000,
    endAtMs: 2000,
    times: [1500, 2500],
  },
  {
    name: 'petting-existing-pose',
    petting: true,
    handContact: true,
    gesture: 'explain',
    strokeUntilMs: 2000,
    endAtMs: 2000,
    times: [500, 1500, 2500, 4000, 4200],
  },
];

void app.whenReady().then(async () => {
  let window: BrowserWindow | undefined;
  const result: any = {
    verifiedAt: new Date().toISOString(),
    model: 'local user-provided model',
    scope: {
      canvas: [360, 560],
      simulationStepMs: 50,
      rendering: 'local Cubism SDK / SwiftShader checkpoints',
      providers: false,
      tts: false,
    },
    networkRequests: [],
    after: {},
    'owned-lean': {},
    assertions: [],
  };
  try {
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] },
      (request, callback) => {
        result.networkRequests.push(new URL(request.url).protocol);
        callback({ cancel: true });
      },
    );
    process.send?.({ kind: 'expression-progress', stage: 'model-load' });
    const library = new ModelLibrary();
    const inventory = await library.load(arg('--model'));
    protocol.handle('app', (request) => {
      const url = new URL(request.url);
      if (url.host === 'model') return library.handle(url);
      if (url.host === 'runtime') {
        const file =
          url.pathname === '/core.js'
            ? join(root, 'vendor/core/live2dcubismcore.min.js')
            : join(
                root,
                'vendor/framework/Shaders/WebGL',
                url.pathname.replace(/^\/shaders\//, ''),
              );
        return net.fetch(pathToFileURL(file).href);
      }
      if (url.host === 'ui' && /^\/(after|owned-lean)\.(html|js)$/.test(url.pathname))
        return net.fetch(pathToFileURL(join(build, url.pathname)).href);
      return new Response('', { status: 404 });
    });
    for (const mode of ['after', 'owned-lean']) {
      process.send?.({ kind: 'expression-progress', stage: 'renderer-setup', mode });
      window = new BrowserWindow({
        width: 360,
        height: 560,
        useContentSize: true,
        show: false,
        transparent: true,
        frame: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      });
      await window.loadURL(`app://ui/${mode}.html`);
      const js = (source: string): Promise<any> => window!.webContents.executeJavaScript(source);
      const mappings = await js(
        `expressionAcceptance.setup(${JSON.stringify(inventory)},${mode === 'owned-lean'})`,
      );
      if (mode === 'owned-lean') result.ownedLeanSetup = mappings;
      else {
        result.mappings = mappings;
        idleFaceAt = mappings.idleSchedule.face;
        idleHandAt = mappings.idleSchedule.hand;
        idleEdges = mappings.idleSchedule.edges;
        scenes = createScenes();
      }
      const selectedScenes = mode === 'owned-lean' ? ownedLeanScenes : scenes;
      for (const scene of selectedScenes) {
        assert.ok(
          scene.times.every(
            (time, index) =>
              Number.isFinite(time) && time >= 0 && (!index || time > scene.times[index - 1]!),
          ),
          `${scene.name}: capture times must increase strictly`,
        );
        process.send?.({
          kind: 'expression-progress',
          stage: 'scene-start',
          mode,
          scene: scene.name,
        });
        const samples = await js(`expressionAcceptance.run(${JSON.stringify(scene)})`);
        result[mode][scene.name] = samples;
        for (const sample of samples) {
          const png = sample.png;
          delete sample.png;
          assert.equal(
            sample.rangeErrors.length,
            0,
            `${mode}/${scene.name}/${sample.time}: parameter range`,
          );
          const image = `${mode}-${scene.name}-${sample.time}.png`;
          await writeFile(join(output, image), Buffer.from(png.split(',')[1], 'base64'));
          sample.image = image;
          process.send?.({
            kind: 'expression-progress',
            stage: 'capture-written',
            mode,
            scene: scene.name,
          });
          assert.ok(
            sample.opaquePixels > 1000,
            `${mode}/${scene.name}: blank render (${JSON.stringify(sample.status)})`,
          );
        }
      }
      process.send?.({ kind: 'expression-progress', stage: 'renderer-complete', mode });
      window.destroy();
      window = undefined;
    }
    const sample = (scene: string, time: number): any => {
      const entry = result.after[scene]?.find((frame: any) => frame.time === time);
      assert.ok(entry, `Missing acceptance checkpoint: ${scene}/${time}`);
      return entry;
    };
    const check = (name: string, condition: boolean): void => {
      if (condition) result.assertions.push(name);
      else (result.failedAssertions ??= []).push(name);
    };
    // A zero crossing may briefly grow one axis while the full damped pose settles.
    const postureSettles = (name: string): boolean => {
      const axes = ['headX', 'headY', 'headZ', 'bodyX', 'bodyZ', 'lean', 'approach'];
      const magnitude = (time: number): number =>
        Math.hypot(...axes.map((key) => sample(name, time).frame[key]));
      return (
        magnitude(4800) < magnitude(4200) &&
        axes.every((key) => Math.abs(sample(name, 6200).frame[key]) < 0.01)
      );
    };
    check(
      'ordinary neutral dialogue finishes its acknowledgement without face afterglow or a hand',
      sample('semantic-neutral', 1000).frame.active &&
        [1800, 3000].every((time) => {
          const entry = sample('semantic-neutral', time);
          return (
            !entry.frame.active &&
            entry.layers.length === 0 &&
            entry.pose.phase === 'none' &&
            Math.abs(entry.values.Movement2) < 0.001 &&
            Math.abs(entry.values.Movement3) < 0.001
          );
        }),
    );
    check(
      'default happy uses procedural eyes',
      sample('happy', 1000).values.key5 === 0 && sample('happy', 1000).values.EyeSmile > 0.05,
    );
    const idleSpan = (name: string, parameter: string): number => {
      const values = scenes
        .find((scene) => scene.name === name)!
        .times.map((time) => sample(name, time).values[parameter]);
      return Math.max(...values) - Math.min(...values);
    };
    check(
      'idle has a modest finite glance with a centered rest and preserved breathing',
      sample('idle-life', 5000).frame.headX === 0 &&
        Math.abs(sample('idle-life', 7000).frame.gazeX) > 0.001 &&
        Math.abs(sample('idle-life', 10000).frame.gazeX) < 0.005 &&
        Math.abs(sample('idle-life', 10000).frame.headX) < 0.005 &&
        Math.abs(sample('idle-life', 10000).frame.bodyX) < 0.005 &&
        idleSpan('idle-life', 'ParamAngleX') > 0.1 &&
        sample('idle-life', 2000).frame.breath !== sample('idle-life', 3000).frame.breath,
    );
    check(
      'reduced motion suppresses actual idle head and torso outputs',
      ['ParamAngleX', 'ParamBodyAngleX'].every(
        (parameter) =>
          idleSpan('idle-life-reduced', parameter) < idleSpan('idle-life', parameter) * 0.25,
      ),
    );
    check(
      'happy laugh closes eyes without key5',
      sample('happy-laugh', 1000).values.key5 === 0 &&
        sample('happy-laugh', 1000).values.ParamEyeLOpen < 0.5 &&
        sample('happy-laugh', 1000).values.ParamMouthOpenY >
          sample('happy', 1000).values.ParamMouthOpenY + 0.1,
    );
    check(
      'blush and procedural laugh overlap',
      sample('embarrassed-laugh', 1000).values.key7 > 0.5 &&
        sample('embarrassed-laugh', 1000).values.EyeSmile > 0.05,
    );
    check(
      'worried teasing keeps its sweat without the deadpan eye artwork',
      sample('concerned-tease', 700).values.key13 > 0.5 &&
        sample('concerned-tease', 700).values.key6 === 0,
    );
    check(
      'worried teasing starts attentive and frowning, then gives a closed-mouth playful reply',
      sample('concerned-tease', 700).values.ParamMouthForm < -0.5 &&
        sample('concerned-tease', 700).values.ParamEyeLOpen > 0.75 &&
        sample('concerned-tease', 3000).values.ParamMouthForm > 0.15 &&
        sample('concerned-tease', 3000).values.ParamMouthOpenY === 0 &&
        sample('concerned-tease', 3000).values.key13 > 0.5 &&
        sample('concerned-tease', 3000).values.Movement2 === 0,
    );
    check(
      'tease eye art releases independently of the sweat marking',
      sample('concerned-tease', 1400).values.key6 === 0 &&
        sample('concerned-tease', 1400).values.key13 > 0.5,
    );
    check(
      'saved key5 mapping wins',
      sample('saved-happy', 700).values.key5 > 0.5 &&
        sample('saved-happy', 700).values.EyeSmile === 0 &&
        sample('saved-happy', 700).values.ParamMouthOpenY >
          sample('saved-joy', 700).values.ParamMouthOpenY * 2,
    );
    check(
      'saved laugh eye artwork releases without changing the saved mapping',
      sample('saved-happy', 1400).values.key5 === 0,
    );
    check(
      'saved happy eye accent gives way to the existing open-eyed joy without a new hand',
      sample('saved-joy', 700).values.key5 > 0.5 &&
        sample('saved-joy', 1500).values.key5 > 0.5 &&
        sample('saved-joy', 2300).values.key5 === 0 &&
        sample('saved-joy', 3000).values.EyeSmile > 0.1 &&
        sample('saved-joy', 3000).values.ParamEyeLOpen > 0.5 &&
        sample('saved-joy', 3000).values.Movement2 === 0 &&
        !sample('saved-joy', 6200).frame.active,
    );
    check(
      'local idle hand has one finite smile and returns to the original idle face',
      sample('idle-expressive', handAt(1150)).values.ParamMouthForm >
        sample('idle-expressive', handAt(2750)).values.ParamMouthForm + 0.2 &&
        sample('idle-expressive', handAt(1150)).values.EyeSmile > 0.3 &&
        sample('idle-expressive', handAt(1150)).values.ParamMouthOpenY ===
          sample('idle-expressive', handAt(2750)).values.ParamMouthOpenY,
    );
    check(
      'pure anger briefly checks the listener without losing its closed-mouth frown or starting a hand',
      sample('angry', 2200).frame.eyeL > sample('angry', 3150).frame.eyeL + 0.05 &&
        sample('angry', 2600).values.ParamMouthForm < 0 &&
        sample('angry', 2600).values.ParamMouthOpenY === 0 &&
        sample('angry', 2600).values.Movement2 === 0 &&
        sample('angry', 3150).frame.gesture === 'none',
    );
    check(
      'angry shoulders briefly loosen with the existing eye check and stay averted',
      sample('angry', 2600).beforePhysics.PositionX >
        sample('angry', 1000).beforePhysics.PositionX + 0.5 &&
        sample('angry', 2600).beforePhysics.PositionX < 0 &&
        sample('angry', 2600).beforePhysics.LeanInput <
          sample('angry', 1000).beforePhysics.LeanInput &&
        sample('angry', 2600).frame.approach <= 0,
    );
    check(
      'confused recoil becomes curious rig posture independently of canvas approach',
      sample('confused', 1000).beforePhysics.LeanInput > 0 &&
        sample('confused', 3000).beforePhysics.LeanInput < -3 &&
        sample('confused', 3000).beforePhysics.PositionZ < 0 &&
        sample('confused', 3000).frame.approach <= 0,
    );
    check(
      'worried teasing releases the guarded shoulders into a physical invitation',
      sample('concerned-tease', 1000).beforePhysics.PositionX < 0 &&
        sample('concerned-tease', 3000).beforePhysics.PositionX > 0 &&
        sample('concerned-tease', 1000).beforePhysics.LeanInput > 0 &&
        sample('concerned-tease', 3000).beforePhysics.LeanInput < -3,
    );
    check(
      'playful wink has counterbalanced shoulders and real forward rig depth',
      sample('lean-tease', 1000).beforePhysics.PositionZ > 0 &&
        sample('lean-tease', 1000).beforePhysics.AngleZ < 0 &&
        sample('lean-tease', 1000).beforePhysics.LeanInput < -3 &&
        sample('lean-tease', 1000).frame.lean > sample('lean-tease', 1000).frame.approach,
    );
    check(
      'joy and laughter make one real forward body phrase and settle without a hand pose',
      ['happy', 'happy-laugh'].every(
        (scene) =>
          sample(scene, 1000).values.Param50 > 0.1 &&
          sample(scene, 3000).values.Param50 < sample(scene, 1000).values.Param50 * 0.5 &&
          [300, 1000, 2000, 3000].every((time) => sample(scene, time).pose.phase === 'none'),
      ),
    );
    check(
      'anger turns the actual head aside and partially reconnects while retaining its side posture',
      sample('angry', 1000).values.ParamAngleX < -10 &&
        sample('angry', 3000).values.ParamAngleX > sample('angry', 1000).values.ParamAngleX + 1 &&
        sample('angry', 3000).values.ParamAngleX < -5 &&
        sample('angry', 1000).values.ParamMouthOpenY === 0,
    );
    check(
      'concerned teasing uses a restrained actual bow, then reconnects without an authored hand',
      sample('concerned-tease', 1000).values.ParamAngleY > -12 &&
        sample('concerned-tease', 1000).values.ParamAngleY < -4 &&
        sample('concerned-tease', 3000).values.ParamAngleY >
          sample('concerned-tease', 1000).values.ParamAngleY + 2 &&
        sample('concerned-tease', 3000).pose.phase === 'none',
    );
    check(
      'worried teasing keeps an initial concern face before a delayed unilateral wink',
      sample('concerned-tease', 700).values.ParamEyeLOpen > 0.4 &&
        sample('concerned-tease', 700).values.ParamEyeROpen > 0.4 &&
        sample('concerned-tease', 1000).values.ParamMouthForm < -0.9 &&
        sample('concerned-tease', 1000).values.ParamBrowLY < 0 &&
        sample('concerned-tease', 1000).frame.browY < -0.2 &&
        sample('concerned-tease', 3000).values.ParamBrowLY >
          sample('concerned-tease', 1000).values.ParamBrowLY + 0.2 &&
        sample('concerned-tease', 1000).values.ParamEyeLOpen > 0.4 &&
        sample('concerned-tease', 2000).values.ParamEyeLOpen < 0.2 &&
        sample('concerned-tease', 2000).values.ParamEyeROpen > 0.5,
    );
    check(
      'angry afterglow is a light closed-mouth face with no artwork',
      sample('angry', 4800).frame.active &&
        sample('angry', 4800).frame.expressionWeight <= 0.4 &&
        sample('angry', 4800).values.key6 === 0 &&
        sample('angry', 4800).values.ParamMouthOpenY === 0 &&
        sample('angry', 4800).values.ParamMouthForm < 0 &&
        Math.abs(sample('angry', 4800).frame.headX) < 0.01 &&
        Math.abs(sample('angry', 4800).frame.bodyZ) < 0.01,
    );
    check(
      'angry lids approach neutral before semantic and preview deadlines instead of snapping open',
      sample('angry', 6150).frame.eyeL > 0.98 &&
        sample('angry', 6150).frame.eyeR > 0.98 &&
        Math.abs(sample('angry', 6200).frame.eyeL - sample('angry', 6150).frame.eyeL) < 0.02 &&
        sample('preview-angry', 4150).frame.eyeL > 0.98 &&
        sample('preview-angry', 4150).frame.eyeR > 0.98 &&
        Math.abs(
          sample('preview-angry', 4200).frame.eyeL - sample('preview-angry', 4150).frame.eyeL,
        ) < 0.02,
    );
    check(
      'semantic joy retains only a light face afterglow before its six-point-two-second deadline',
      sample('happy', 4800).frame.active &&
        sample('happy', 4800).values.ParamMouthForm > 0 &&
        sample('happy', 4800).frame.expressionWeight <= 0.4 &&
        !sample('happy', 6200).frame.active &&
        sample('happy', 6200).layers.length === 0 &&
        sample('happy', 8000).values.ParamMouthForm === 0,
    );
    check(
      'light laughter afterglow keeps a closed-mouth grin and finishes before joy',
      sample('happy-laugh', 4800).values.ParamMouthOpenY < 0.00001 &&
        sample('happy-laugh', 4800).values.ParamMouthForm >
          sample('happy', 4800).values.ParamMouthForm &&
        !sample('happy-laugh', 5600).frame.active &&
        sample('happy', 5600).frame.active,
    );
    check(
      'idle begins centered and recenters between finite glances',
      [2000, 3000, 4000, 5000, 6000, 10000].every(
        (time) =>
          Math.abs(sample('idle-life', time).frame.gazeX) < 0.005 &&
          Math.abs(sample('idle-life', time).frame.headZ) < 0.005 &&
          Math.abs(sample('idle-life', time).frame.bodyZ) < 0.005,
      ),
    );
    check(
      'laughter and sulking settle their existing damped axes without late motion accents',
      ['happy-laugh', 'angry'].every(
        (name) => postureSettles(name) && sample(name, 4800).values.Movement2 === 0,
      ),
    );
    check(
      'explain adds one early arm accent while preserving selectors and fingers',
      sample('explain', 2400).values.Param41 > sample('explain', 2000).values.Param41 + 0.03 &&
        sample('explain', 2900).values.Param41 < sample('explain', 2000).values.Param41 &&
        [2400, 2800, 2900].every(
          (time) =>
            sample('explain', time).values.Movement3 === 1 &&
            Math.abs(
              sample('explain', time).values.Param36 - sample('explain', 2000).values.Param36,
            ) < 0.001 &&
            Math.abs(
              sample('explain', time).values.Param42 - sample('explain', 2000).values.Param42,
            ) < 0.001,
        ),
    );
    check(
      'short explain preview joins its actual early held arm overlay at return entry',
      sample('preview-explain', 2749).status.posePhase === 'hold' &&
        sample('preview-explain', 2750).status.posePhase === 'exit' &&
        // The original pair's Param41 endpoint is .702 -> .700; allow that
        // measured asset difference plus one millisecond of natural motion.
        Math.abs(
          sample('preview-explain', 2750).values.Param41 -
            sample('preview-explain', 2749).values.Param41,
        ) < 0.003 &&
        sample('preview-explain', 4200).status.posePhase === 'none' &&
        Math.abs(sample('preview-explain', 4200).values.Movement3) < 0.001,
    );
    check(
      'short greeting preview joins its partially relaxed hold without a return pop',
      sample('preview-wave', 2632).status.posePhase === 'hold' &&
        sample('preview-wave', 2633).status.posePhase === 'exit' &&
        Math.abs(
          sample('preview-wave', 2633).values.Param62 - sample('preview-wave', 2632).values.Param62,
        ) < 0.002 &&
        Math.abs(sample('preview-wave', 3650).values.Movement2) < 0.001 &&
        sample('preview-wave', 3650).status.posePhase === 'none',
    );
    check(
      'independent emotion torsos have distinct early authored shoulder rolls and side postures',
      sample('torso-shy', 1000).values.ParamBodyAngleZ > 1 &&
        sample('torso-laugh', 1000).values.ParamBodyAngleZ < -1 &&
        sample('torso-angry', 1000).values.PositionX < -1,
    );
    check(
      'laughter has two unequal pitch accents with a recovery and counter-tilt on the actual rig',
      sample('torso-laugh', 650).values.AngleY < sample('torso-laugh', 1200).values.AngleY - 3 &&
        sample('torso-laugh', 1700).values.AngleY < sample('torso-laugh', 1200).values.AngleY - 2 &&
        sample('torso-laugh', 1700).values.AngleY > sample('torso-laugh', 650).values.AngleY + 1 &&
        sample('torso-laugh', 2400).values.AngleY > sample('torso-laugh', 1700).values.AngleY + 2 &&
        sample('torso-laugh', 650).values.AngleZ > sample('torso-laugh', 1700).values.AngleZ + 8,
    );
    check(
      'the finite laughter phrase preserves no-hand ownership and its short semantic deadline',
      ['torso-laugh', 'torso-laugh-reduced'].every(
        (name) =>
          result.after[name].every(
            (entry: any) =>
              entry.frame.gesture === 'none' &&
              Math.abs(entry.values.Movement2) < 0.001 &&
              Math.abs(entry.values.Movement3) < 0.001,
          ) && !sample(name, 5600).frame.active,
      ),
    );
    check(
      'reduced motion limits both laughter pitch accents without reopening the held mouth',
      [650, 1700].every(
        (time) =>
          Math.abs(sample('torso-laugh-reduced', time).values.AngleY) <
          Math.abs(sample('torso-laugh', time).values.AngleY) * 0.25,
      ) && Math.abs(sample('torso-laugh-reduced', 4800).values.ParamMouthOpenY) < 1e-6,
    );
    check(
      'emotion torso intent settles after the short accent and retains no authored hand',
      ['torso-happy', 'torso-laugh', 'torso-shy', 'torso-angry'].every(
        (name) =>
          result.after[name].every(
            (entry: any) =>
              Math.abs(entry.values.Movement2) < 0.001 &&
              Math.abs(entry.values.Movement3) < 0.001 &&
              entry.frame.gesture === 'none',
          ) &&
          !sample(name, 6200).frame.active &&
          postureSettles(name),
      ),
    );
    check(
      'reduced motion limits the early independent torso without starting a hand',
      Math.abs(sample('torso-shy-reduced', 1000).values.ParamBodyAngleZ) <
        Math.abs(sample('torso-shy', 1000).values.ParamBodyAngleZ) * 0.25 &&
        Math.abs(sample('torso-shy-reduced', 1000).values.PositionX) <
          Math.abs(sample('torso-shy', 1000).values.PositionX) * 0.25 &&
        sample('torso-shy-reduced', 4800).values.Movement2 === 0 &&
        Math.abs(sample('torso-shy-reduced', 4800).values.ParamMouthOpenY) < 1e-6,
    );
    check(
      'idle does not add a periodic roll while early emotional roll still reaches authored physics',
      result.after['idle-life'].every((entry: any) => Math.abs(entry.frame.bodyZ) < 0.001) &&
        Math.abs(sample('happy-laugh', 1000).values.PositionZ) > 1 &&
        Math.abs(sample('happy-laugh', 1000).values.ParamBodyAngleZ) > 0.5,
    );
    check(
      'direct affection also owns the bounded torso roll and releases it with contact',
      sample('petting-right', 600).values.PositionZ > 1 &&
        sample('petting-right', 600).values.ParamBodyAngleZ < -0.5 &&
        Math.abs(sample('petting-right', 1800).frame.bodyZ) < 0.3 * 0.65,
    );
    check(
      'rare idle extras occur only on their original sixteenth and eighth slot edges',
      idleEdges.length === 16 &&
        idleEdges[0] === 6000 &&
        idleEdges
          .slice(1)
          .every(
            (time, index) => time - idleEdges[index]! >= 7000 && time - idleEdges[index]! <= 11000,
          ) &&
        idleEdges.every((time, index) => {
          const entry = sample('idle-expressive', time + 350);
          return (
            entry.gazeSlotId === index + 1 &&
            !!entry.status.localIdleAttention === ((index + 1) % 16 === 8) &&
            !!entry.status.localIdleGesture === ((index + 1) % 16 === 0)
          );
        }),
    );
    check(
      'expressive idle gives one finite eye greeting without a message, mouth opening or hand',
      !!sample('idle-attention', faceAt(350)).status.localIdleAttention &&
        Math.abs(
          sample('idle-attention', faceAt(350)).values.ParamEyeLOpen -
            sample('idle-attention', faceAt(350)).values.ParamEyeROpen,
        ) > 0.5 &&
        sample('idle-attention', faceAt(500)).values.ParamMouthForm > 0.45 &&
        sample('idle-attention', faceAt(350)).values.ParamMouthOpenY === 0 &&
        sample('idle-attention', faceAt(350)).values.Movement2 === 0 &&
        !sample('idle-attention', faceAt(350)).frame.active &&
        !sample('idle-attention', faceAt(1350)).status.localIdleAttention &&
        Math.abs(sample('idle-attention', faceAt(1350)).values.ParamMouthForm) < 0.001,
    );
    check(
      'idle eye greeting respects accessibility, quiet and normal modes, work and active semantic none',
      [
        'idle-expressive-reduced',
        'idle-normal-long',
        'idle-quiet-long',
        'idle-working',
        'active-none-expressive',
      ].every(
        (name) =>
          !sample(name, name === 'active-none-expressive' ? 1000 : faceAt(350)).status
            .localIdleAttention,
      ),
    );
    check(
      'held contact and petting residue consume the eye edge without delayed attention after release',
      ['idle-attention-held', 'idle-attention-residue'].every((name) =>
        result.after[name].every((entry: any) => !entry.status.localIdleAttention),
      ) &&
        sample('idle-attention-residue', faceAt(-250)).status.pettingWeight > 0.5 &&
        sample('idle-attention-residue', faceAt(650)).status.pettingWeight === 0,
    );
    check(
      'a new contact cancels an existing idle eye greeting without restarting it on the same slot',
      !!sample('idle-attention-interrupt', faceAt(350)).status.localIdleAttention &&
        [faceAt(450), faceAt(500), faceAt(750), faceAt(1350)].every(
          (time) => !sample('idle-attention-interrupt', time).status.localIdleAttention,
        ),
    );
    check(
      'approval immediately clears the independently owned idle eye greeting',
      !!sample('idle-attention-approval', faceAt(350)).status.localIdleAttention &&
        !sample('idle-attention-approval', faceAt(450)).status.localIdleAttention &&
        !sample('idle-attention-approval', faceAt(750)).status.localIdleAttention,
    );
    check(
      'expressive idle uses one locally owned chest gesture with no semantic cue',
      sample('idle-expressive', handAt(-100)).values.Movement2 === 0 &&
        !!sample('idle-expressive', handAt(1150)).status.localIdleGesture &&
        sample('idle-expressive', handAt(1150)).values.Movement2 > 0.9 &&
        !sample('idle-expressive', handAt(1150)).frame.active &&
        sample('idle-expressive', handAt(1150)).frame.gesture === 'none' &&
        !sample('idle-expressive', handAt(2750)).status.localIdleGesture &&
        Math.abs(sample('idle-expressive', handAt(2750)).values.Movement2) < 0.001,
    );
    check(
      'idle hands respect reduced motion, normal and quiet intensity, saved mapping and active work',
      [
        'idle-expressive-reduced',
        'idle-expressive-custom',
        'idle-expressive-empty',
        'idle-normal-long',
        'idle-quiet-long',
        'idle-working',
      ].every((name) =>
        result.after[name].every(
          (entry: any) =>
            !entry.status.localIdleGesture && Math.abs(entry.values.Movement2) < 0.001,
        ),
      ),
    );
    check(
      'active semantic none never starts the independent idle hand',
      result.after['active-none-expressive'].every(
        (entry: any) =>
          entry.frame.active &&
          !entry.status.localIdleGesture &&
          Math.abs(entry.values.Movement2) < 0.001,
      ),
    );
    check(
      'an approval immediately clears the locally owned idle hand',
      !!sample('idle-approval', handAt(1150)).status.localIdleGesture &&
        !sample('idle-approval', handAt(1250)).status.localIdleGesture &&
        Math.abs(sample('idle-approval', handAt(1250)).values.Movement2) < 0.001,
    );
    check(
      'contact during an idle hand keeps its old deadline and remains body-only for that touch',
      !!sample('idle-contact', handAt(1150)).status.localIdleGesture &&
        sample('idle-contact', handAt(1150)).status.pettingWeight > 0.5 &&
        !sample('idle-contact', handAt(1150)).petting.poseOwned &&
        !sample('idle-contact', handAt(2750)).status.localIdleGesture &&
        sample('idle-contact', handAt(3150)).status.pettingWeight > 0.5 &&
        Math.abs(sample('idle-contact', handAt(3150)).values.Movement2) < 0.001 &&
        !sample('idle-contact', handAt(3150)).petting.poseOwned,
    );
    check(
      'afterglow expires within budget',
      !sample('happy', 6200).frame.active && sample('happy', 6200).layers.length === 0,
    );
    for (const [scene, selector] of [
      ['explain', 'Movement3'],
      ['wave', 'Movement2'],
    ]) {
      const held = sample(scene, scene === 'wave' ? 2500 : 2900),
        done = sample(scene, 4200);
      check(
        `${scene} retains its authored early hand hold`,
        held.pose.phase === 'hold' && held.values[selector!] > 0.5,
      );
      check(
        `${scene} finishes its authored return by the short accent deadline`,
        done.pose.phase === 'none' && Math.abs(done.values[selector!]) < 1e-5,
      );
      const endpoints = held.handEndpoints[held.pose.definition.enter].exit;
      const errors = Object.entries(endpoints).filter(
        ([id, value]) =>
          !done.idleParameters.includes(id) && Math.abs(done.handValues[id] - Number(value)) > 0.02,
      );
      const heldEndpoints = held.handEndpoints[held.pose.definition.enter].enter;
      if (scene === 'wave') {
        check(
          'greeting holds an open palm instead of the authored chest endpoint',
          held.values.Param60 > 0.65 &&
            held.values.Param60 < 0.8 &&
            held.values.Param61 > 0.08 &&
            held.values.Param62 < -0.4,
        );
        check(
          'greeting has two finite wrist sweeps with a folded elbow before resting',
          sample('wave', 1283).values.Param61 > held.values.Param61 + 0.04 &&
            sample('wave', 1583).values.Param61 < held.values.Param61 - 0.04 &&
            sample('wave', 1883).values.Param61 > held.values.Param61 + 0.03 &&
            sample('wave', 2183).values.Param61 < held.values.Param61 - 0.015 &&
            Math.abs(sample('wave', 2500).values.Param61 - held.values.Param61) < 0.001,
        );
      } else
        // The shorter hold reaches a partial .027 forearm relaxation before return,
        // rather than the former full plateau after eight seconds.
        check(
          `${scene} relaxes only the verified forearm while preserving fingers and selectors`,
          Object.entries(heldEndpoints).every(
            ([id, value]) =>
              id === 'Param41' || Math.abs(held.handValues[id] - Number(value)) < 0.02,
          ) && held.values.Param41 < Number(heldEndpoints.Param41) - 0.02,
        );
      check(`${scene} authored hand return endpoints`, errors.length === 0);
      check(
        `${scene} does not restart a hand or late lift after its short budget`,
        [4800, 6200, 8000].every(
          (time) =>
            sample(scene, time).pose.phase === 'none' &&
            Math.abs(sample(scene, time).values[selector!]) < 1e-5,
        ),
      );
    }
    check(
      'shortened greeting return stays visibly inside both canvas sides',
      result.after.wave
        .filter((entry: any) => entry.time >= 3183 && entry.time <= 4200)
        .every((entry: any) => entry.sideBoundaryPixels === 0),
    );
    check(
      'cue clear removes residue and hand',
      sample('clear', 2000).pose.phase === 'hold' &&
        !sample('clear', 2100).frame.active &&
        sample('clear', 2100).layers.length === 0 &&
        sample('clear', 2100).pose.phase === 'none',
    );
    check(
      'cue clear also removes the independently shortened face afterglow',
      sample('clear-afterglow', 4800).frame.active &&
        !sample('clear-afterglow', 4900).frame.active &&
        sample('clear-afterglow', 4900).layers.length === 0,
    );
    check(
      'reduced motion removes authored hand and reduces mouth residue',
      sample('reduced', 4800).pose.phase === 'none' &&
        sample('reduced', 4800).values.ParamMouthOpenY <
          sample('happy', 4800).values.ParamMouthOpenY * 0.25,
    );
    check(
      'angry uses supported brow and pout controls',
      sample('angry', 1000).values.ParamBrowLY < 0 &&
        sample('angry', 1000).values.ParamBrowRY < 0 &&
        sample('angry', 1000).values.Mouthpucker > 0,
    );
    check(
      'angry mouth remains closed and its frown fades by the short deadline',
      sample('angry', 1000).values.ParamMouthForm < -0.9 &&
        sample('angry', 4800).values.ParamMouthForm < 0 &&
        sample('angry', 4800).values.ParamMouthOpenY === 0 &&
        sample('angry', 6200).values.ParamMouthForm === 0,
    );
    check(
      'confused special eyes own the eye shape',
      sample('confused', 1000).values.key3 > 0.5 && sample('confused', 1000).values.EyeSmile === 0,
    );
    check(
      'confused eye artwork is a brief accent, not a long sticker',
      sample('confused', 1600).values.key3 === 0,
    );
    check(
      'confused eye return switches drawings without partial gray artwork',
      [1200, 1250].every((time) => [0, 1].includes(sample('confused', time).values.key3)),
    );
    check(
      'explain head responds at hand entry and returns without later maintenance accents',
      sample('explain', 1300).frame.headY < sample('explain', 2000).frame.headY - 0.03 &&
        [4800, 6200, 8000].every(
          (time) =>
            Math.abs(sample('explain', time).frame.headY) < 0.01 &&
            sample('explain', time).pose.phase === 'none',
        ),
    );
    check(
      'local petting produces smile and independent release',
      sample('petting', 500).petting.weight > 0.5 &&
        sample('petting', 500).values.EyeSmile > 0.1 &&
        sample('petting', 1800).petting.weight === 0,
    );
    check(
      'petting makes a finite affectionate approach through the real forward-lean physics',
      sample('petting', 500).values.LeanInput < -1 &&
        sample('petting', 500).values.Param50 > 0.04 &&
        sample('petting', 1800).values.Param50 < sample('petting', 500).values.Param50 * 0.5,
    );
    const handRest = (scene: string, time: number): boolean => {
      const frame = sample(scene, time);
      return (
        frame.pose.phase === 'none' &&
        !frame.petting.poseOwned &&
        Math.abs(frame.values.Movement2) < 0.01 &&
        Math.abs(frame.values.Param60) < 0.02
      );
    };
    check(
      'validated direct petting uses the original chest hand without adding a semantic gesture',
      sample('petting-held', 2500).petting.poseOwned &&
        sample('petting-held', 2500).pose.phase === 'hold' &&
        sample('petting-held', 2500).values.Movement2 > 0.99 &&
        sample('petting-held', 2500).values.Param60 > 0.8 &&
        sample('petting-held', 2500).frame.gesture === 'none' &&
        handRest('petting-held', 4050),
    );
    check(
      'early direct-input return starts at the last rendered hand and rests within its release budget',
      ['Movement2', 'Param56', 'Param57', 'Param62', 'Param59', 'Param60', 'Param61'].every(
        (parameter) =>
          Math.abs(
            sample('petting-early-release', 400).values[parameter] -
              sample('petting-early-release', 425).values[parameter],
          ) < 0.0001,
      ) && handRest('petting-early-release', 850),
    );
    check(
      'stationary petting returns the hand by the original nine-hundred-millisecond deadline',
      sample('petting-stationary-hand', 1500).petting.poseOwned &&
        sample('petting-stationary-hand', 1650).pose.phase === 'exit' &&
        sample('petting-stationary-hand', 1900).pose.phase === 'exit' &&
        handRest('petting-stationary-hand', 2400) &&
        sample('petting-stationary-hand', 2400).petting.weight === 0 &&
        ['Param62', 'Param59', 'Param60', 'Param61'].every(
          (id) =>
            Math.abs(
              sample('petting-stationary-hand', 1650).values[id] -
                sample('petting-stationary-hand', 1500).values[id],
            ) < 0.001 &&
            sample('petting-stationary-hand', 1900).values[id] >= -1 &&
            sample('petting-stationary-hand', 1900).values[id] <= 1,
        ) &&
        sample('petting-stationary-hand', 1900).values.Param62 < -0.35 &&
        sample('petting-stationary-hand', 1900).values.Param60 > 0.4 &&
        sample('petting-stationary-hand', 1900).values.Param60 <
          sample('petting-stationary-hand', 1650).values.Param60 &&
        Math.abs(
          sample('petting-stationary-hand', 1900).values.Param61 -
            sample('petting-stationary-hand', 1650).values.Param61,
        ) < 0.05 &&
        sample('petting-stationary-hand', 1650).values.Movement2 > 0.9 &&
        sample('petting-stationary-hand', 1500).values.Movement2 > 0.9,
    );
    check(
      'continuous petting completes the authored return inside the original twelve-second cap',
      sample('petting-twelve-second-hand', 10000).petting.poseOwned &&
        sample('petting-twelve-second-hand', 11000).pose.phase === 'exit' &&
        handRest('petting-twelve-second-hand', 12000) &&
        sample('petting-twelve-second-hand', 12000).petting.weight === 0,
    );
    check(
      'custom mappings, reduced motion and insufficient late budgets keep body-only petting',
      ['petting-custom-wave', 'petting-reduced-hand', 'petting-late-hand'].every((scene) =>
        result.after[scene].every(
          (frame: any) =>
            !frame.petting.poseOwned &&
            frame.pose.phase === 'none' &&
            Math.abs(frame.values.Movement2) < 0.01,
        ),
      ) && sample('petting-late-hand', 11000).petting.weight > 0.5,
    );
    check(
      'direct petting never takes or clears an existing semantic explain pose',
      [500, 1500, 2500].every(
        (time) =>
          !sample('petting-existing-pose', time).petting.poseOwned &&
          sample('petting-existing-pose', time).values.Movement3 > 0.99 &&
          Math.abs(sample('petting-existing-pose', time).values.Movement2) < 0.01,
      ) &&
        sample('petting-existing-pose', 4000).pose.phase === 'exit' &&
        sample('petting-existing-pose', 4200).pose.phase === 'none',
    );
    check(
      'rapid recontact preserves the visible body and the original owned hand return',
      sample('petting-recontact', 1851).petting.poseOwned &&
        sample('petting-recontact', 1851).pose.phase === 'exit' &&
        sample('petting-recontact', 1851).renderMatrix.every(
          (value: number, index: number) =>
            Math.abs(value - sample('petting-recontact', 1850).renderMatrix[index]) < 0.002,
        ) &&
        Math.abs(
          sample('petting-recontact', 1851).values.ParamEyeLOpen -
            sample('petting-recontact', 1850).values.ParamEyeLOpen,
        ) < 0.01 &&
        handRest('petting-recontact', 2650) &&
        sample('petting-recontact', 3000).petting.weight > 0.5,
    );
    check(
      'repeated no-stroke contacts cannot recycle the old affection or hand deadline',
      sample('petting-recontact-no-stroke', 1851).petting.poseOwned &&
        sample('petting-recontact-no-stroke', 1900).petting.weight <=
          sample('petting-recontact-no-stroke', 1851).petting.weight &&
        sample('petting-recontact-no-stroke', 2050).petting.weight <
          sample('petting-recontact-no-stroke', 1900).petting.weight &&
        handRest('petting-recontact-no-stroke', 2650) &&
        sample('petting-recontact-no-stroke', 2650).petting.weight === 0 &&
        sample('petting-recontact-no-stroke', 2700).petting.weight === 0,
    );
    check(
      'a scoped semantic clear preserves the independently owned direct-contact response',
      !sample('petting-scoped-clear', 1500).frame.active &&
        sample('petting-scoped-clear', 1500).petting.poseOwned &&
        sample('petting-scoped-clear', 1500).values.Movement2 > 0.99 &&
        sample('petting-scoped-clear', 1500).petting.weight > 0.5 &&
        handRest('petting-scoped-clear', 3050),
    );
    check(
      'petting zone selects only the upper model silhouette',
      sample('petting', 500).petting.headHit && !sample('petting', 500).petting.lowerHit,
    );
    check(
      'petting adds only the saved blush and a visible local tilt',
      sample('petting', 500).values.key7 > 0.1 && sample('petting', 500).beforePhysics.AngleZ > 1,
    );
    check(
      'petting briefly retains affection after release and then returns',
      sample('petting', 1400).status.pettingWeight > 0.03 &&
        sample('petting', 1400).values.key7 > 0.02 &&
        sample('petting', 1800).values.key7 === 0,
    );
    check(
      'local contact direction reaches actual head and eye inputs',
      sample('petting-left', 600).values.AngleX < -2 &&
        sample('petting-right', 600).values.AngleX > 2 &&
        sample('petting-left', 600).values.ParamEyeBallX < -0.1 &&
        sample('petting-right', 600).values.ParamEyeBallX > 0.1,
    );
    check(
      'contact head direction survives the model physics',
      sample('petting-left', 600).values.ParamAngleX < -1 &&
        sample('petting-right', 600).values.ParamAngleX > 1,
    );
    check(
      'contact direction releases without keeping the blush or direct input active',
      ['petting-left', 'petting-right'].every(
        (scene) =>
          sample(scene, 1800).status.pettingWeight === 0 && sample(scene, 1800).values.key7 === 0,
      ),
    );
    const postureNeutral = sample('posture-neutral', 3000);
    const postureForward = sample('posture-forward', 3000);
    const approachOnly = sample('approach-only', 3000);
    check(
      'rig forward posture preserves canvas framing and reaches authored physics',
      JSON.stringify(postureForward.renderMatrix) === JSON.stringify(postureNeutral.renderMatrix) &&
        Math.abs(postureNeutral.beforePhysics.LeanInput) < 1e-6 &&
        Math.abs(postureForward.beforePhysics.LeanInput + 10.5) < 1e-4 &&
        postureForward.values.Param50 > postureNeutral.values.Param50 + 0.1,
    );
    check(
      'canvas approach changes framing independently of rig posture',
      JSON.stringify(approachOnly.renderMatrix) !== JSON.stringify(postureNeutral.renderMatrix) &&
        Math.abs(approachOnly.beforePhysics.LeanInput) < 1e-6 &&
        Math.abs(approachOnly.renderMatrix[0] / postureNeutral.renderMatrix[0] - 1.125) < 1e-6,
    );
    check(
      'authored idle owns rig depth during full and reduced emotional posture',
      result.ownedLeanSetup.injectedLeanCurves === 1 &&
        result.ownedLeanSetup.idleOwnsLean &&
        !result.ownedLeanSetup.leanChannelAvailable &&
        ownedLeanScenes.every((scene) =>
          result['owned-lean'][scene.name].every(
            (frame: any) => Math.abs(frame.beforePhysics.LeanInput - 5) < 1e-5,
          ),
        ),
    );
    check('no external requests', result.networkRequests.length === 0);
    assert.equal(result.failedAssertions?.length ?? 0, 0, JSON.stringify(result.failedAssertions));
    result.passed = true;
    console.log(
      `표현 렌더 검증 통과: ${result.assertions.length}개 수락 검사, PNG/JSON → artifacts/expression-afterglow/`,
    );
  } catch (error) {
    result.passed = false;
    result.error = error instanceof Error ? error.message : String(error);
    console.error(result.error);
    process.exitCode = 1;
  } finally {
    await mkdir(output, { recursive: true });
    await writeFile(resolve(output, 'results.json'), JSON.stringify(result, null, 2));
    window?.destroy();
    app.exit(process.exitCode ?? 0);
  }
});
