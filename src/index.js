import {
  buildPixelDiff,
  getDataset,
  generateVegaRendering,
  generateVegaView,
  checkIfSpecIsSupported,
  concatImages
} from './utils';
import algebraicRules from './rules/algebraic-rules';
import deceptionRules from './rules/deception-rules';
import {SPEC_NOT_SUPPORTED, CRASH, OK} from './codes';

// todo should make the lint rules generate their own specs
const lintRules = [
  ...algebraicRules,
  ...deceptionRules
  // the map adds default inclusion
].map(d => ({filter: () => true, ...d}));

const evalMap = {
  'algebraic-spec': evaluateAlgebraicSpecRule,
  'algebraic-data': evaluateAlgebraicDataRule,
  stylistic: evaluateStylisticRule
};

export function lint(spec) {
  if (!checkIfSpecIsSupported(spec)) {
    return Promise.resolve({code: SPEC_NOT_SUPPORTED, lints: []});
  }
  // this function wraps the single lint function, so that each individual layer
  // in the vega-lite spec is linted by itself. It is unclear if this stratagey is a good one.
  const denormalizedLayers = !spec.layer ? [spec] : spec.layer.map(innerSpec => {
    const result = {
      ...spec,
      layer: [],
      ...innerSpec
    };
    delete result.layer;
    return result;
  });
  return Promise
    .all(denormalizedLayers.map(singleSpec => lintSingleSpec(singleSpec)))
    .then(results => results.reduce((acc, row) => acc.concat(row), []))
    .then(lints => ({code: OK, lints}))
    .catch(e => {
      /* eslint-disable no-console */
      console.log(e);
      /* eslint-enable no-console */
      return {
        code: CRASH,
        lints: [],
        msg: e
      };
    });
}

export function lintSingleSpec(spec) {
  // TODO should link the size of these to the sizes in the other render path
  const specWithDefaults = {
    // width: 200,
    // height: 200,
    // autosize: {
    //   type: 'fit',
    //   contains: 'padding'
    // },
    ...spec
  };
  // generateVegaRendering(specWithDefaults, 'svg').then(x => {
  //   console.log(x)
  // })
  return Promise.all([
    getDataset(specWithDefaults),
    generateVegaView(specWithDefaults)
  ])
  .then(([dataset, view]) => {
    return Promise.all(
      lintRules
        .filter(({filter}) => filter(specWithDefaults, dataset, view))
        .map(rule => evalMap[rule.type](rule, specWithDefaults, dataset, view))
    );
  });
}

function evaluateAlgebraicSpecRule(rule, spec, dataset, oldView) {
  const {operation, evaluator, name, explain} = rule;
  const perturbedSpec = operation(spec);
  return Promise.all([
    generateVegaRendering(spec, 'raster'),
    generateVegaRendering(perturbedSpec, 'raster'),
    generateVegaView(perturbedSpec)
  ])
  .then(([oldRendering, newRendering, newView]) => {
    const passed = evaluator(
      oldRendering,
      newRendering,
      spec,
      perturbedSpec,
      oldView,
      newView
    );
    return {name, explain, passed};
  });
}

function evaluateAlgebraicDataRule(rule, spec, dataset, oldView) {
  const {operation, evaluator, name, explain} = rule;
  const perturbedSpec = {...spec, data: {values: operation(dataset, spec, oldView)}};
  return Promise.all(
    [spec, perturbedSpec].map(d => generateVegaRendering(d, 'raster'))
  )
  .then(([oldRendering, newRendering]) => {
    const failRender = buildPixelDiff(oldRendering, newRendering).diffStr;
    const passed = evaluator(oldRendering, newRendering, spec);

    // type is there to allow for svg renders, still to come
    return {
      name,
      explain,
      passed,
      failedRender: !passed ? {
        type: 'raster',
        render: concatImages([oldRendering, newRendering, failRender])
      } : null
    };
  });
}

function evaluateStylisticRule(rule, spec, dataset, oldView) {
  const {evaluator, name, explain = 'todo'} = rule;

  return generateVegaRendering(spec, 'svg')
  .then(([view, render]) => {
    const passed = evaluator(oldView, spec, render);
    return {name, explain, passed, failedRender: null};
  });
}
