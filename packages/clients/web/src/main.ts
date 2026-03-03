import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import "@xterm/xterm/css/xterm.css";

const app = createApp(App);
app.use(createPinia());
app.mount("#app");
