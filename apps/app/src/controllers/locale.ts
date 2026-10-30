import { ReactiveController, ReactiveControllerHost } from "lit";
import EnLang from "../locale/en.json";
import KoLang from "../locale/ko.json";

type AbleLanguage = "en" | "ko";

export class LocaleController implements ReactiveController {
  host: ReactiveControllerHost;

  value: AbleLanguage = "ko";

  constructor(host: ReactiveControllerHost) {
    (this.host = host).addController(this);

    window.electronAPI.req.store.get("LANG").then((item) => {
      this.value = item.value || "ko";
      document.documentElement.lang = this.value;
    });
  }

  public t(target) {
    if (this.value == "en") {
      return this.getValueByPath(EnLang, target);
    }

    if (this.value == "ko") {
      return this.getValueByPath(KoLang, target);
    }
  }

  public changeLanguage(lang: AbleLanguage) {
    this.value = lang;
    document.documentElement.lang = lang;
    window.electronAPI.req.store.set("LANG", lang);
  }

  private getValueByPath(json, path) {
    if (typeof path !== "string" || !path) {
      return "";
    }

    const keys = path.split(".");
    let current = json;

    for (const key of keys) {
      if (current && Object.prototype.hasOwnProperty.call(current, key)) {
        current = current[key];
      } else {
        return "";
      }
    }

    return current;
  }

  hostConnected() {
    window.electronAPI.req.store.get("LANG").then((item) => {
      this.value = item.value || "ko";
      document.documentElement.lang = this.value;
      this.host.requestUpdate();
    });
  }
  hostDisconnected() {}
}
