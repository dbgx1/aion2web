import { DevtoolsProvider, PiPProvider } from '../chunk/USF7DF4E.js';
import '../chunk/GZI3DACQ.js';
import { render, createComponent, Portal } from 'solid-js/web';
import { lazy } from 'solid-js';
import { ClientEventBus } from '@tanstack/devtools-event-bus/client';

function mountDevtools(options) {
  const {
    el,
    plugins,
    config,
    eventBusConfig,
    onSetPlugins
  } = options;
  const eventBus = new ClientEventBus(eventBusConfig);
  eventBus.start();
  const Devtools = lazy(() => import('../devtools/3GWKGGQS.js'));
  const dispose = render(() => createComponent(DevtoolsProvider, {
    plugins,
    config,
    onSetPlugins,
    get children() {
      return createComponent(PiPProvider, {
        get children() {
          return createComponent(Portal, {
            mount: el,
            get children() {
              return createComponent(Devtools, {});
            }
          });
        }
      });
    }
  }), el);
  return {
    dispose,
    eventBus
  };
}

export { mountDevtools };
