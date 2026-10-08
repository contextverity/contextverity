/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ChildProcess, execFileSync, spawn } from 'node:child_process';
import { BackstageHarness } from './BackstageHarness';
import { Capability, Tier } from './types';

export interface KubernetesHarnessOptions {
  rootDir: string;
  kubeContext: string;
  namespace: string;
  /** Helm release name; resources are `<release>-contextverity-lab`. */
  release: string;
  /** Local port for `kubectl port-forward` to the backend service. */
  localPort: number;
}

/**
 * The live harness pointed at the lab deployed with the Helm chart. Adds the
 * capabilities a cluster provides: restarting the pod (receipts must survive
 * on the persistent volume) and editing the stored receipt inside the pod.
 */
export class KubernetesHarness extends BackstageHarness {
  readonly tier: Tier = 'kubernetes';
  readonly capabilities: ReadonlySet<Capability> = new Set<Capability>([
    'restart',
    'storage-tamper',
  ]);
  private portForward?: ChildProcess;

  static async create(
    options: KubernetesHarnessOptions,
  ): Promise<KubernetesHarness> {
    const kube = kubectl(options);
    const name = `${options.release}-contextverity-lab`;
    const secret = (key: string) =>
      Buffer.from(
        kube([
          'get',
          'secret',
          `${name}-secrets`,
          '-o',
          `jsonpath={.data.${key}}`,
        ]),
        'base64',
      ).toString('utf8');
    const harness = new KubernetesHarness(options, {
      rootDir: options.rootDir,
      baseUrl: `http://127.0.0.1:${options.localPort}`,
      agentToken: secret('CV_AGENT_TOKEN'),
      otherAgentToken: secret('CV_OTHER_AGENT_TOKEN'),
    });
    await harness.connect();
    return harness;
  }

  private constructor(
    private readonly k8s: KubernetesHarnessOptions,
    base: ConstructorParameters<typeof BackstageHarness>[0],
  ) {
    super(base);
  }

  private get resource() {
    return `${this.k8s.release}-contextverity-lab`;
  }

  private async connect() {
    this.portForward?.kill();
    this.portForward = spawn(
      'kubectl',
      [
        '--context',
        this.k8s.kubeContext,
        '-n',
        this.k8s.namespace,
        'port-forward',
        `svc/${this.resource}`,
        `${this.k8s.localPort}:7007`,
      ],
      { stdio: 'ignore' },
    );
    const started = Date.now();
    while (Date.now() - started < 60_000) {
      try {
        const res = await fetch(
          `${this.options.baseUrl}/.backstage/health/v1/readiness`,
        );
        if (res.ok) return;
      } catch {
        // not yet
      }
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('port-forward to the lab did not become ready');
  }

  async restart(): Promise<void> {
    const kube = kubectl(this.k8s);
    kube([
      'delete',
      'pod',
      '-l',
      `app.kubernetes.io/instance=${this.k8s.release}`,
      '--wait=true',
    ]);
    kube([
      'rollout',
      'status',
      `deployment/${this.resource}`,
      '--timeout=300s',
    ]);
    this.userToken = undefined;
    await this.connect();
  }

  async tamperStoredReceipt(receiptId: string): Promise<void> {
    // Runs inside the pod with the image's own better-sqlite3.
    const script = [
      "const Database = require('/app/node_modules/better-sqlite3');",
      "const db = new Database('/data/db/contextverity.sqlite');",
      'const id = process.argv[1];',
      "const row = db.prepare('select body from contextverity_receipts where receipt_id = ?').get(id);",
      "const body = JSON.parse(row.body); body.grant.sensitivityCeiling = 'RESTRICTED';",
      "db.prepare('update contextverity_receipts set body = ? where receipt_id = ?').run(JSON.stringify(body), id);",
    ].join(' ');
    kubectl(this.k8s)([
      'exec',
      `deployment/${this.resource}`,
      '-c',
      'backend',
      '--',
      'node',
      '-e',
      script,
      receiptId,
    ]);
  }

  async close(): Promise<void> {
    this.portForward?.kill();
  }
}

function kubectl(o: { kubeContext: string; namespace: string }) {
  return (args: string[]) =>
    execFileSync(
      'kubectl',
      ['--context', o.kubeContext, '-n', o.namespace, ...args],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ).trim();
}
