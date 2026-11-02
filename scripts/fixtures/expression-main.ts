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
  { name: 'happy', emotion: 'happy', times: [1000, 8000, 16200] },
  { name: 'happy-laugh', emotion: 'happy', attitude: 'laugh', times: [1000, 8000, 15600] },
  {
    name: 'embarrassed-laugh',
    emotion: 'embarrassed',
    attitude: 'laugh',
    times: [1000, 8000, 15600],
  },
  { name: 'concerned-tease', emotion: 'concerned', attitude: 'tease', times: [1000, 8000, 16200] },
  { name: 'explain', gesture: 'explain', times: [500, 2000, 8000, 15000, 16200] },
  { name: 'wave', gesture: 'wave', times: [500, 2000, 8000, 15000, 16200] },
  {
    name: 'saved-happy',
    emotion: 'happy',
    attitude: 'laugh',
    savedHappy: true,
    times: [1000, 8000],
  },
  { name: 'clear', emotion: 'happy', gesture: 'explain', clearAt: 8050, times: [8000, 8100] },
  {
    name: 'reduced',
    emotion: 'happy',
    gesture: 'explain',
    reducedMotion: true,
    times: [1000, 8000, 16200],
  },
  { name: 'angry', emotion: 'angry', times: [1000, 8000, 16200] },
  { name: 'confused', emotion: 'confused', times: [1000, 8000, 16200] },
  ...['sad', 'concerned', 'angry', 'confused', 'reassure', 'wave'].map((preview) => ({
    name: `preview-${preview}`,
    preview,
    times: [1000],
  })),
  { name: 'petting', petting: true, times: [500, 1600] },
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
      'sweat and tease eye art overlap',
      sample('concerned-tease', 1000).values.key13 > 0.5 &&
        sample('concerned-tease', 1000).values.key6 > 0.5,
    );
    check(
      'saved key5 mapping wins',
      sample('saved-happy', 1000).values.key5 > 0.5 &&
        sample('saved-happy', 1000).values.EyeSmile === 0,
    );
    check(
      'semantic face remains at eight seconds',
      sample('happy', 8000).values.ParamMouthForm > 0 &&
        sample('happy', 8000).values.ParamMouthOpenY > 0.01,
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
      check(
        `${scene} complete authored hold endpoints`,
        Object.entries(heldEndpoints).every(
          ([id, value]) => Math.abs(held.handValues[id] - Number(value)) < 0.02,
        ),
      );
      check(`${scene} authored hand return endpoints`, errors.length === 0);
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
      'confused special eyes own the eye shape',
      sample('confused', 1000).values.key3 > 0.5 && sample('confused', 1000).values.EyeSmile === 0,
    );
    check(
      'local petting produces smile and independent release',
      sample('petting', 500).petting.weight > 0.5 &&
        sample('petting', 500).values.EyeSmile > 0.1 &&
        sample('petting', 1600).petting.weight === 0,
    );
    check(
      'petting zone selects only the upper model silhouette',
      sample('petting', 500).petting.headHit && !sample('petting', 500).petting.lowerHit,
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
