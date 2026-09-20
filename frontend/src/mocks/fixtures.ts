import type { Recommendation, RunReport, ScenarioKind, HealthResponse, ModelArtifact, StateResponse, WhatifResponse } from '@/types';
// Canonical fixtures from docs/api/90-examples-and-mocks.md.
export const health = {
  "status": "ok",
  "contract": "1.0.0",
  "core": "0.1.0",
  "modelsLoaded": 1
} satisfies HealthResponse;
export const state = {
  "tPoint": "2026-09-19T08:00:00Z",
  "tags": [
    {
      "tagCode": "24-2000.P8",
      "ts": "2026-09-19T08:00:00Z",
      "value": 341.2,
      "qualityFlag": "ok",
      "source": "kip",
      "unit": "°C"
    },
    {
      "tagCode": "T11",
      "ts": "2026-09-19T08:00:00Z",
      "value": 286.5,
      "qualityFlag": "ok",
      "source": "kip",
      "unit": "°C"
    },
    {
      "tagCode": "Q21",
      "ts": "2026-09-19T08:00:00Z",
      "value": null,
      "qualityFlag": "sentinel",
      "source": "pak",
      "unit": "мг/кг"
    }
  ],
  "freshness": [
    {
      "pointId": "hdu_product_sulfur",
      "source": "lims",
      "lastSampleTs": "2026-09-18T06:00:00Z",
      "availableTs": "2026-09-18T10:00:00Z",
      "ageHours": 44,
      "status": "stale",
      "warnAfterH": 28,
      "staleAfterH": 52
    },
    {
      "pointId": "blend_product_cn",
      "source": "pak",
      "lastSampleTs": "2026-09-19T06:30:00Z",
      "availableTs": "2026-09-19T06:30:00Z",
      "ageHours": 1.5,
      "status": "ok",
      "warnAfterH": 28,
      "staleAfterH": 52
    }
  ],
  "lastRun": {
    "runId": "20260919-080000-3f9c2a",
    "decision": "recommend"
  }
} satisfies StateResponse;
export const normalReport = {
  "runId": "20260919-080000-3f9c2a",
  "createdAt": "2026-09-19T08:00:00Z",
  "status": "completed",
  "scenario": {
    "scenarioId": "b41d9f02",
    "kind": "quality_risk",
    "tPoint": "2026-06-15T08:00:00Z",
    "overrides": {
      "blend_share_kerosene": 0.12
    },
    "description": "2026 прижат к границе по сере",
    "seed": 42
  },
  "dataHashes": {
    "data/processed/telemetry.parquet": "e3b0c4429804fc2a…",
    "data/processed/lims.parquet": "bd9a3c1f77e02d64…"
  },
  "versions": {
    "python": "3.12.6",
    "lightgbm": "4.5.0",
    "core": "0.1.0",
    "contract": "1.0.0"
  },
  "env": {
    "mode": "api",
    "llm_mode": "off"
  },
  "freshness": [
    {
      "pointId": "hdu_product_sulfur",
      "source": "lims",
      "lastSampleTs": "2026-06-14T06:00:00Z",
      "availableTs": "2026-06-14T10:00:00Z",
      "ageHours": 22,
      "status": "ok",
      "warnAfterH": 28,
      "staleAfterH": 52
    }
  ],
  "quality": [
    {
      "target": "sulfur",
      "horizonH": 2,
      "unit": "мг/кг",
      "p10": 8.9,
      "p50": 9.6,
      "p90": 10.4,
      "intervalWidth": 1.5,
      "specRisk": 0.38,
      "conformalApplied": true,
      "modelArtifactId": "sulfur-lgbm-a1b2c3d4",
      "shapTopK": [
        {
          "feature": "T5",
          "value": 371,
          "contribution": 0.42
        }
      ],
      "computedAt": "2026-09-19T08:05:00Z"
    }
  ],
  "agentsTrace": [
    {
      "runId": "20260919-080000-3f9c2a",
      "stepIdx": 1,
      "agentRole": "quality",
      "startedAt": "2026-09-19T08:00:03Z",
      "finishedAt": "2026-09-19T08:00:05Z",
      "durationMs": 2100,
      "inputDigest": "9f2a1c4e8b7d0f31",
      "inputSummary": {
        "targets": [
          "sulfur",
          "t95"
        ]
      },
      "output": {
        "sulfur": {
          "p50": 9.6,
          "p10": 8.9,
          "p90": 10.4
        }
      },
      "notes": [
        "Прогноз серы у верхней границы; конформ расширил интервал до 1,5."
      ],
      "numberRefs": [
        {
          "path": "sulfur.p50",
          "value": 9.6,
          "unit": "мг/кг",
          "label": "Прогноз серы P50"
        }
      ],
      "confidence": 0.71
    }
  ],
  "recommendation": {
    "runId": "20260919-080000-3f9c2a",
    "createdAt": "2026-09-19T08:05:01Z",
    "tPoint": "2026-09-19T08:00:00Z",
    "decision": "recommend",
    "state": [
      {
        "tag": "Q21",
        "value": 9.4,
        "unit": "мг/кг"
      },
      {
        "tag": "T5",
        "value": 371,
        "unit": "°C"
      }
    ],
    "risks": [
      {
        "target": "sulfur",
        "limit": "≤ 10 мг/кг",
        "limitValue": 10,
        "p50": 9.6,
        "p10": 8.9,
        "p90": 10.4,
        "specRisk": 0.38
      }
    ],
    "actions": [
      {
        "tag": "24-2000.P8",
        "unit": "°C",
        "currentValue": 341.2,
        "recommendedValue": 339.5,
        "deltaPct": -0.5
      }
    ],
    "effects": [
      {
        "target": "sulfur",
        "unit": "мг/кг",
        "baselineP50": 9.6,
        "actionP50": 9.1,
        "p10": 8.4,
        "p90": 9.8,
        "marginToSpec": 0.9
      }
    ],
    "checks": [
      {
        "constraintId": "sulfur_max",
        "description": "сера ≤ 10 мг/кг",
        "limit": 10,
        "unit": "мг/кг",
        "value": 9.8,
        "passed": true
      },
      {
        "constraintId": "t95_max",
        "description": "T95 ≤ 360 °C",
        "limit": 360,
        "unit": "°C",
        "value": 355.1,
        "passed": true
      },
      {
        "constraintId": "cetane_min_summer",
        "description": "ЦЧ ≥ 51 (летнее)",
        "limit": 51,
        "unit": "пункт",
        "value": 52.3,
        "passed": true
      }
    ],
    "confidence": {
      "p10": 0.62,
      "p90": 0.88
    },
    "explanation": "Снижение T ГСС на 1,7 °C уменьшает серу ~0,5 мг/кг (санити ~0,3 мг/кг/°C) и снимает риск off-spec; запас по T95 и ЦЧ сохраняется.",
    "alternatives": [
      {
        "label": "Присадка 1,5 %",
        "actions": [
          {
            "tag": "blend_additive_pct",
            "unit": "%",
            "currentValue": 0,
            "recommendedValue": 1.5,
            "deltaPct": null
          }
        ],
        "quality": [
          {
            "target": "cetane",
            "p10": 51.8,
            "p50": 52.3,
            "p90": 52.9
          }
        ],
        "costIndex": 1.5,
        "paretoRank": 2
      }
    ],
    "refusal": null
  },
  "durationMs": 12400,
  "artifacts": {
    "reportMd": "artifacts/runs/20260919-080000-3f9c2a.md",
    "reportJson": "artifacts/runs/20260919-080000-3f9c2a.json",
    "timeline": "artifacts/timeline/20260919-080000-3f9c2a.ndjson"
  }
} satisfies RunReport;
export const whatifResult = {
  "tPoint": "2026-09-19T08:00:00Z",
  "elapsedMs": 31,
  "baseline": [
    {
      "target": "sulfur",
      "p50": 9.6,
      "p10": 8.9,
      "p90": 10.4,
      "specRisk": 0.38,
      "unit": "мг/кг"
    }
  ],
  "variants": [
    {
      "overrides": {
        "24-2000.P8": 339.5
      },
      "quality": [
        {
          "target": "sulfur",
          "p50": 9.1,
          "p10": 8.4,
          "p90": 9.8,
          "specRisk": 0.11,
          "unit": "мг/кг"
        }
      ],
      "costIndex": 1,
      "feasible": true,
      "violations": []
    },
    {
      "overrides": {
        "24-2000.P8": 336,
        "blend_additive_pct": 1.5
      },
      "quality": [
        {
          "target": "sulfur",
          "p50": 8.7,
          "p10": 8,
          "p90": 9.4,
          "specRisk": 0.04,
          "unit": "мг/кг"
        }
      ],
      "costIndex": 2.3,
      "feasible": false,
      "violations": [
        "t95_max: прогноз T95 361,2 > 360 °C"
      ]
    }
  ]
} satisfies WhatifResponse;
export const models = [
  {
    "artifactId": "sulfur-lgbm-a1b2c3d4",
    "target": "sulfur",
    "algorithm": "lightgbm_quantile",
    "quantiles": [
      0.1,
      0.5,
      0.9
    ],
    "modelUri": "artifacts/models/sulfur-lgbm-a1b2c3d4/model.txt",
    "conformal": {
      "method": "enbpi",
      "params": {
        "gamma": 0.05,
        "cv": "split"
      }
    },
    "coverage": 0.83,
    "metrics": {
      "wape": 0.061,
      "mae": 0.52,
      "pinball_p50": 0.35
    },
    "trainedOnRange": {
      "start": "2023-01-01T00:00:00Z",
      "end": "2026-06-30T00:00:00Z"
    },
    "features": [
      "T5",
      "T11",
      "lims_age_h",
      "cat_age_days"
    ],
    "monotoneConstraints": {
      "T5": 1
    },
    "createdAt": "2026-09-18T20:10:00Z",
    "seed": 42,
    "coreVersion": "0.1.0",
    "active": true,
    "hyperparams": {},
    "dataHashes": {}
  }
] satisfies ModelArtifact[];
export const freshnessOk = normalReport.freshness;
export function recommendation(runId:string,kind:ScenarioKind):Recommendation {
 const base:Recommendation=structuredClone(normalReport.recommendation);
 base.runId=runId;
 if(kind==='normal'){
   base.explanation='Режим устойчив, качество с запасом в спецификации. Сохранить текущие уставки.';
   base.actions=base.actions?.map(action=>({...action,recommendedValue:action.currentValue,deltaPct:0}));
   base.risks=base.risks.map(risk=>({...risk,p10:7.5,p50:8.2,p90:8.9,specRisk:.03}));
   base.effects=base.effects?.map(effect=>({...effect,baselineP50:8.2,actionP50:8.2,p10:7.5,p90:8.9,marginToSpec:1.8}));
 }
 if(kind==='sour_crude'){
   base.explanation='Рост сернистости сырья требует корректировки температуры и долей блендинга.';
   base.actions=[...(base.actions??[]),{tag:'blend_share_kerosene',unit:'доля',currentValue:.12,recommendedValue:.08,deltaPct:-33.33}];
 }
 if(kind!=='stale_lims'&&kind!=='bad_data')return base;
 return {runId,createdAt:base.createdAt,tPoint:base.tPoint,decision:'refuse',state:base.state,risks:base.risks,explanation:'Безопасная рекомендация невозможна: требуется проверить источники данных.',alternatives:[],refusal:{reasons:kind==='bad_data'?['sensor_fault','wide_interval']:['stale_lims','wide_interval'],details:kind==='bad_data'?['Обнаружены неисправные датчики.','Интервал прогноза пересекает границу качества.']:['Возраст последнего ЛИМС 54 ч превышает порог 52 ч.','Интервал серы 8,9–10,4 мг/кг пересекает границу 10 мг/кг.']}};
}
export function report(runId:string,kind:ScenarioKind):RunReport{
 const result:RunReport=structuredClone(normalReport);result.runId=runId;result.scenario.kind=kind;result.recommendation=recommendation(runId,kind);
 result.status=result.recommendation.decision==='refuse'?'refused':'completed';
 result.agentsTrace=result.agentsTrace.map(step=>({...step,runId}));
 if(kind==='stale_lims')result.freshness=result.freshness.map(item=>({...item,status:'stale',ageHours:54}));
 if(kind==='bad_data')result.freshness=result.freshness.map(item=>({...item,status:'missing',ageHours:null,lastSampleTs:null,availableTs:null}));
 return result;
}
