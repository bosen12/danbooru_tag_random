/** UI-agnostic commands. Future 3D workbench can call these without reading engine internals. */

export function createCommands(hooks) {
  const h = hooks || {};
  return {
    pin(tag) {
      return h.pin(tag);
    },
    ban(tag) {
      return h.ban(tag);
    },
    applyRecipe(recipe) {
      return h.applyRecipe(recipe);
    },
    generate(opts) {
      return h.generate(opts);
    },
  };
}
