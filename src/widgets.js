// -----------------------------------------------------------------------------
// Dashboard widgets (SDK v0.14+, Gladys 5.1+).
//
// A widget puts the integration's own data on the Gladys dashboard without a
// dedicated core widget. The manifest `widgets` field declares its identity
// (key, label, icon, optional per-instance `settings`); at runtime the
// integration returns a DECLARATIVE content — `text`, `value`, `gauge`,
// `status`, `chart`, `card-list`, `image`, `button` — that the core renders
// with its own theme, dark mode and translations. No HTML, no CSS.
//
// Each entry of WIDGETS is keyed by the widget `key` and exposes:
//   - get(gladys, { settings, language, units, config }): the content,
//     registered by index.js with `gladys.onWidgetGet(key, ...)`;
//   - action(gladys, { actionKey, params, settings, config }) (optional): a
//     tapped `button` carrying an `action`, registered with
//     `gladys.onWidgetAction`.
//
// Check your contents in the tests with `validateWidgetContent` (exported by
// the SDK, see test/widgets.test.js), or run with DEBUG=gladys-integration-sdk
// to have the SDK log every violation of the vocabulary and the budget.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_TRANSPORTS,
  WIDGET_COLORS,
} from '@gladysassistant/integration-sdk';
import { identifyDevice } from './devices/index.js';
import { weatherStation } from './devices/weatherStation.js';
import { plug } from './devices/plug.js';
import { light } from './devices/light.js';

const logger = createLogger({ name: 'widgets' });

// Widget key, as declared in the manifest `widgets` field.
export const DEMO_STATUS_WIDGET = 'demo_status';

// Keys of the `button` actions the demo_status content declares.
const DEMO_STATUS_ACTIONS = { IDENTIFY_LIGHT: 'identify_light' };

// How the plug transport reads in the status list.
const TRANSPORT_STATUS = {
  [DEVICE_TRANSPORTS.LOCAL]: { value: { en: 'Local', fr: 'Locale' }, color: WIDGET_COLORS.SUCCESS },
  [DEVICE_TRANSPORTS.CLOUD]: { value: { en: 'Cloud', fr: 'Cloud' }, color: WIDGET_COLORS.INFO },
  [DEVICE_TRANSPORTS.UNREACHABLE]: {
    value: { en: 'Unreachable', fr: 'Injoignable' },
    color: WIDGET_COLORS.DANGER,
  },
};

// A live tile references a feature by its external_id: read it from the
// discovery payload itself, so the widget and the device never disagree.
function featureExternalId(gladys, config, blueprint, category) {
  const device = blueprint.buildDevice(gladys, config);
  return device.features.find((feature) => feature.category === category).external_id;
}

function plugConnectionStatus(gladys, config) {
  const { transport, degraded } = plug.transport(gladys, config);
  const { value, color } = TRANSPORT_STATUS[transport];
  if (degraded) {
    return {
      value: { en: `${value.en} (degraded mode)`, fr: `${value.fr} (mode dégradé)` },
      color: WIDGET_COLORS.WARNING,
    };
  }
  return { value, color };
}

export const WIDGETS = {
  [DEMO_STATUS_WIDGET]: {
    // `settings` holds the per-instance values of the declared `settings`
    // (none here); `language` and `units` are those of the user viewing the
    // dashboard, for the values you format yourself. Multi-language objects
    // (`{ en, fr }`) are picked by the core, like everywhere else.
    async get(gladys, { config }) {
      logger.debug(`onWidgetGet <- ${DEMO_STATUS_WIDGET}`);
      return {
        // Reload policy: the computed parts below only change with the
        // config, and index.js nudges the widget on every (re)connection and
        // config update (see refreshWidgets) — the TTL is just a safety net.
        ttl_seconds: 300,
        components: [
          // Device-bound tiles: LIVE, they follow the published states over
          // the core's real-time path. No TTL, no nudge involved.
          {
            type: 'value',
            label: { en: 'Temperature', fr: 'Température' },
            icon: 'thermometer',
            device_feature: featureExternalId(
              gladys,
              config,
              weatherStation,
              DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
            ),
          },
          {
            type: 'value',
            label: { en: 'Office plug', fr: 'Prise du bureau' },
            icon: 'zap',
            device_feature: featureExternalId(
              gladys,
              config,
              plug,
              DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
            ),
          },
          // Computed rows: what the integration knows that no device feature
          // carries. Served from the core cache until the TTL or a nudge.
          {
            type: 'status',
            items: [
              {
                label: { en: 'Plug connection', fr: 'Connexion de la prise' },
                icon: 'wifi',
                ...plugConnectionStatus(gladys, config),
              },
              {
                label: { en: 'Observed location', fr: 'Position observée' },
                icon: 'map-pin',
                value: `${config.latitude.toFixed(2)}, ${config.longitude.toFixed(2)}`,
                color: WIDGET_COLORS.NEUTRAL,
              },
            ],
          },
          // `params` are declared HERE and sent back as-is: the handler never
          // receives user input (a dashboard can hang on a public wall).
          {
            type: 'button',
            label: { en: 'Identify the light', fr: 'Identifier la lampe' },
            icon: 'eye',
            style: 'secondary',
            action: {
              key: DEMO_STATUS_ACTIONS.IDENTIFY_LIGHT,
              params: { device: light.deviceExternalId(gladys) },
            },
          },
        ],
      };
    },

    // Resolve an optional toast (string or multi-language object, ≤ 200
    // characters). After a successful action the core drops the cached
    // content and every open dashboard refetches it: no nudge needed.
    async action(gladys, { actionKey, params, config }) {
      logger.info(`onWidgetAction <- ${DEMO_STATUS_WIDGET}.${actionKey}`);
      if (actionKey === DEMO_STATUS_ACTIONS.IDENTIFY_LIGHT) {
        return identifyDevice(gladys, params.device, config);
      }
      // Throwing acks the action as failed: the message reaches the user.
      throw new Error(`Unknown widget action: ${actionKey}`);
    },
  },
};

/**
 * Freshness nudge: ask the core to re-pull every widget NOW instead of
 * waiting for the content TTL. Call it when you KNOW a computed content
 * changed (here: the config, which drives the plug transport and the observed
 * location) — and after every (re)connection, since the nudges are
 * fire-and-forget: rate-limited core-side to 1 per 10 s per widget, dropped
 * silently while disconnected.
 */
export function refreshWidgets(gladys) {
  for (const key of Object.keys(WIDGETS)) {
    gladys.requestWidgetRefresh(key);
  }
}
