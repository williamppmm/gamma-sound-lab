import { exportFileName } from '../export/exportPlan.js';
import { downloadBlob } from './PresetPanel.js';

/**
 * Panel de exportación: renderiza la configuración actual a WAV, muestra el informe de
 * verificación y descarga el archivo. Si la verificación falla, no descarga sin confirmar.
 */
export class ExportPanel {
  #getParams;
  #render;
  #toBlob;
  #el;
  #busy = false;

  /**
   * @param render  (params, { seconds }) → Promise<{ channels, sampleRate, report }>
   * @param toBlob  (rendered, { bitDepth }) → Blob
   */
  constructor(root, { getParams, render, toBlob }) {
    this.#getParams = getParams;
    this.#render = render;
    this.#toBlob = toBlob;
    const $ = (sel) => root.querySelector(sel);
    this.#el = {
      duration: $('#export-duration'),
      format: $('#export-format'),
      button: $('#btn-export'),
      status: $('#export-status'),
      report: $('#export-report'),
    };
    this.#el.button.addEventListener('click', () => this.#export());
  }

  async #export() {
    if (this.#busy) return;
    const e = this.#el;
    const seconds = Number(e.duration.value);
    const bitDepth = Number(e.format.value);
    const params = this.#getParams();
    this.#busy = true;
    e.button.disabled = true;
    e.report.hidden = true;
    e.report.replaceChildren();
    this.#say(`Renderizando ${seconds} s…`);
    const t0 = performance.now();
    try {
      const rendered = await this.#render(params, { seconds });
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      const { report } = rendered;
      this.#showReport(report);
      const blob = this.#toBlob(rendered, { bitDepth });
      const name = exportFileName(params, seconds);
      if (report.ok) {
        downloadBlob(blob, name);
        this.#say(`Exportado y verificado en ${elapsed} s: ${name} (${(blob.size / 1e6).toFixed(1)} MB).`);
      } else {
        this.#say('La verificación encontró diferencias con los parámetros. Revisa el informe.', true);
        const li = document.createElement('li');
        const btn = Object.assign(document.createElement('button'), {
          type: 'button',
          className: 'btn btn--small',
          textContent: 'Descargar de todos modos',
        });
        btn.addEventListener('click', () => downloadBlob(blob, name));
        li.append(btn);
        e.report.append(li);
      }
    } catch (err) {
      console.error(err);
      this.#say(`No se pudo exportar: ${err.message ?? err}`, true);
    } finally {
      this.#busy = false;
      e.button.disabled = false;
    }
  }

  #showReport(report) {
    const list = this.#el.report;
    list.dataset.ok = String(report.ok);
    for (const c of report.checks) {
      const li = document.createElement('li');
      li.textContent = `${c.ok ? '✓' : '✗'} ${c.label}: ${c.detail}`;
      list.append(li);
    }
    list.hidden = false;
  }

  #say(message, isError = false) {
    this.#el.status.textContent = message;
    this.#el.status.dataset.error = String(isError);
  }
}
