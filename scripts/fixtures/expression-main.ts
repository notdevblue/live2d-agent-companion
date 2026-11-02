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
const scenes = [
  ...leanScenes,
  { name: 'idle-life', idle: true, times: [2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000] },
  {
    name: 'idle-life-reduced',
    idle: true,
    reducedMotion: true,
    times: [2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000],
  },
  { name: 'happy', emotion: 'happy', times: [300, 1000, 2000, 3000, 8000, 16200] },
  {
    name: 'happy-laugh',
    emotion: 'happy',
    attitude: 'laugh',
    times: [300, 1000, 2000, 3000, 8000, 15600],
  },
  {
    name: 'embarrassed-laugh',
    emotion: 'embarrassed',
    attitude: 'laugh',
    times: [1000, 8000, 15600],
  },
  {
    name: 'concerned-tease',
    emotion: 'concerned',
    attitude: 'tease',
    times: [300, 700, 1000, 1400, 2000, 3000, 8000, 16200],
  },
  {
    name: 'explain',
    gesture: 'explain',
    times: [500, 1300, 2000, 5500, 7500, 8000, 10000, 15000, 16200],
  },
  {
    name: 'wave',
    gesture: 'wave',
    times: [500, 700, 1050, 1400, 2000, 5500, 8000, 10000, 15000, 16200],
  },
  {
    name: 'saved-happy',
    emotion: 'happy',
    attitude: 'laugh',
    savedHappy: true,
    times: [700, 1000, 1400, 8000],
  },
  { name: 'clear', emotion: 'happy', gesture: 'explain', clearAt: 8050, times: [8000, 8100] },
  {
    name: 'reduced',
    emotion: 'happy',
    gesture: 'explain',
    reducedMotion: true,
    times: [1000, 8000, 16200],
  },
  { name: 'angry', emotion: 'angry', times: [300, 1000, 2000, 3000, 8000, 16100, 16150, 16200] },
  { name: 'confused', emotion: 'confused', times: [1000, 1200, 1250, 1600, 8000, 16200] },
  ...['sad', 'concerned', 'angry', 'confused', 'reassure', 'wave'].map((preview) => ({
    name: `preview-${preview}`,
    preview,
    times: preview === 'angry' ? [1000, 3900, 4150, 4200] : [1000],
  })),
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
    times: [500, 1500, 2500, 4000],
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
    before: {},
    after: {},
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
      if (url.host === 'ui' && /^\/(before|after)\.(html|js)$/.test(url.pathname))
        return net.fetch(pathToFileURL(join(build, url.pathname)).href);
      return new Response('', { status: 404 });
    });
    for (const mode of ['before', 'after']) {
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
      result.mappings = await js(`expressionAcceptance.setup(${JSON.stringify(inventory)})`);
      for (const scene of mode === 'before' ? leanScenes : scenes) {
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
          assert.ok(
            sample.opaquePixels > 1000,
            `${mode}/${scene.name}: blank render (${JSON.stringify(sample.status)})`,
          );
        }
      }
      window.destroy();
      window = undefined;
    }
    const sample = (scene: string, time: number): any =>
      result.after[scene].find((entry: any) => entry.time === time);
    const check = (name: string, condition: boolean): void => {
      assert.ok(condition, name);
      result.assertions.push(name);
    };
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
      'idle attention reaches readable head and delayed torso physics outputs',
      idleSpan('idle-life', 'ParamAngleX') > 5 && idleSpan('idle-life', 'ParamBodyAngleX') > 2,
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
        sample('happy-laugh', 1000).values.ParamEyeLOpen < 0.5,
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
      'tease eye art releases independently of the sweat marking',
      sample('concerned-tease', 1400).values.key6 === 0 &&
        sample('concerned-tease', 1400).values.key13 > 0.5,
    );
    check(
      'saved key5 mapping wins',
      sample('saved-happy', 700).values.key5 > 0.5 &&
        sample('saved-happy', 700).values.EyeSmile === 0,
    );
    check(
      'saved laugh eye artwork releases without changing the saved mapping',
      sample('saved-happy', 1400).values.key5 === 0,
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
      'concerned teasing lowers the actual head before reconnecting without an authored hand',
      sample('concerned-tease', 1000).values.ParamAngleY < -12 &&
        sample('concerned-tease', 3000).values.ParamAngleY >
          sample('concerned-tease', 1000).values.ParamAngleY + 5 &&
        sample('concerned-tease', 3000).pose.phase === 'none',
    );
    check(
      'worried teasing keeps an initial concern face before a delayed unilateral wink',
      sample('concerned-tease', 700).values.ParamEyeLOpen > 0.4 &&
        sample('concerned-tease', 700).values.ParamEyeROpen > 0.4 &&
        sample('concerned-tease', 1000).values.ParamMouthForm < -0.6 &&
        sample('concerned-tease', 2000).values.ParamEyeLOpen < 0.2 &&
        sample('concerned-tease', 2000).values.ParamEyeROpen > 0.5,
    );
    check(
      'held angry face uses readable procedural half-lids while preserving the closed pout',
      ['ParamEyeLOpen', 'ParamEyeROpen'].every(
        (parameter) =>
          sample('angry', 8000).values[parameter] > 0.35 &&
          sample('angry', 8000).values[parameter] < 0.5,
      ) &&
        sample('angry', 8000).values.key6 === 0 &&
        sample('angry', 8000).values.ParamMouthOpenY === 0 &&
        sample('angry', 8000).values.ParamMouthForm < -0.7,
    );
    check(
      'angry lids approach neutral before semantic and preview deadlines instead of snapping open',
      sample('angry', 16150).frame.eyeL > 0.98 &&
        sample('angry', 16150).frame.eyeR > 0.98 &&
        Math.abs(sample('angry', 16200).frame.eyeL - sample('angry', 16150).frame.eyeL) < 0.02 &&
        sample('preview-angry', 4150).frame.eyeL > 0.98 &&
        sample('preview-angry', 4150).frame.eyeR > 0.98 &&
        Math.abs(
          sample('preview-angry', 4200).frame.eyeL - sample('preview-angry', 4150).frame.eyeL,
        ) < 0.02,
    );
    check(
      'semantic joy retains bright eyes and its smile at eight seconds',
      sample('happy', 8000).values.ParamMouthForm > 0 &&
        sample('happy', 8000).values.ParamMouthOpenY > 0.1 &&
        sample('happy', 8000).values.ParamEyeLOpen > 0.8,
    );
    check(
      'held laughter has a stronger closed-mouth grin than bright open-eyed joy',
      sample('happy-laugh', 8000).values.ParamMouthOpenY < 0.00001 &&
        sample('happy-laugh', 8000).values.ParamMouthForm >
          sample('happy', 8000).values.ParamMouthForm &&
        sample('happy', 8000).values.ParamEyeLOpen -
          sample('happy-laugh', 8000).values.ParamEyeLOpen >
          0.25,
    );
    check(
      'idle pupil counter-look is independent of the settled side-facing head',
      sample('idle-life', 3000).values.ParamAngleX *
        sample('idle-life', 3000).values.ParamEyeBallX <
        -0.1 && sample('idle-life', 3000).frame.headX * sample('idle-life', 3000).frame.gazeX < 0,
    );
    check(
      'afterglow expires within budget',
      !sample('happy', 16200).frame.active && sample('happy', 16200).layers.length === 0,
    );
    for (const [scene, selector] of [
      ['explain', 'Movement3'],
      ['wave', 'Movement2'],
    ]) {
      const held = sample(scene, 8000),
        done = sample(scene, 16200);
      check(
        `${scene} remains held at eight seconds`,
        held.pose.phase === 'hold' && held.values[selector!] > 0.5,
      );
      check(
        `${scene} returns before semantic deadline`,
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
          held.values.Param60 > 0.4 &&
            held.values.Param60 < 0.65 &&
            held.values.Param61 > 0.08 &&
            held.values.Param62 < -0.05,
        );
        check(
          'greeting sweeps actual upstream joints before resting',
          Math.abs(sample('wave', 700).values.Param61 - sample('wave', 1050).values.Param61) >
            0.05 && Math.abs(sample('wave', 1400).values.Param61 - held.values.Param61) > 0.03,
        );
      } else
        check(
          `${scene} relaxes only the verified forearm while preserving fingers and selectors`,
          Object.entries(heldEndpoints).every(
            ([id, value]) =>
              id === 'Param41' || Math.abs(held.handValues[id] - Number(value)) < 0.02,
          ) && held.values.Param41 < Number(heldEndpoints.Param41) - 0.05,
        );
      check(`${scene} authored hand return endpoints`, errors.length === 0);
      const joint = scene === 'wave' ? 'Param62' : 'Param41';
      check(
        `${scene} has two finite partial lifts from the relaxed hold`,
        sample(scene, 5500).values[joint] - held.values[joint] > 0.03 &&
          sample(scene, 10000).values[joint] - held.values[joint] > 0.03 &&
          sample(scene, 5500).values[joint] > sample(scene, 10000).values[joint],
      );
    }
    check(
      'cue clear removes residue and hand',
      !sample('clear', 8100).frame.active &&
        sample('clear', 8100).layers.length === 0 &&
        sample('clear', 8100).pose.phase === 'none',
    );
    check(
      'reduced motion removes authored hand and reduces mouth residue',
      sample('reduced', 8000).pose.phase === 'none' &&
        sample('reduced', 8000).values.ParamMouthOpenY <
          sample('happy', 8000).values.ParamMouthOpenY * 0.25,
    );
    check(
      'angry uses supported brow and pout controls',
      sample('angry', 1000).values.ParamBrowLY < 0 &&
        sample('angry', 1000).values.ParamBrowRY < 0 &&
        sample('angry', 1000).values.Mouthpucker > 0,
    );
    check(
      'angry mouth reads as a frown and never opens during its residue',
      sample('angry', 1000).values.ParamMouthForm < -0.9 &&
        sample('angry', 8000).values.ParamMouthForm < -0.7 &&
        sample('angry', 8000).values.ParamMouthOpenY === 0,
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
      'explain head responds at hand entry and once during its long hold',
      sample('explain', 1300).frame.headY < sample('explain', 2000).frame.headY - 0.03 &&
        sample('explain', 7500).frame.headY < sample('explain', 8000).frame.headY - 0.03,
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
        handRest('petting-stationary-hand', 2400) &&
        sample('petting-stationary-hand', 2400).petting.weight === 0,
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
      [500, 1500, 2500, 4000].every(
        (time) =>
          !sample('petting-existing-pose', time).petting.poseOwned &&
          sample('petting-existing-pose', time).values.Movement3 > 0.99 &&
          Math.abs(sample('petting-existing-pose', time).values.Movement2) < 0.01,
      ) && sample('petting-existing-pose', 4000).pose.phase === 'hold',
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
    result.leanComparison = leanScenes.map(({ name }) => {
      const before = result.before[name][0],
        after = result.after[name][0];
      assert.ok(
        Math.abs(after.beforePhysics.LeanInput - 2 * before.beforePhysics.LeanInput) < 1e-5,
        `${name}: lean coefficient`,
      );
      return {
        scene: name,
        before: before.beforePhysics.LeanInput,
        after: after.beforePhysics.LeanInput,
        images: [before.image, after.image],
      };
    });
    check('no external requests', result.networkRequests.length === 0);
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
