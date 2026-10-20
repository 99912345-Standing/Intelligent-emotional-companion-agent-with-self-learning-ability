export function activate(api) {
  api.registerTool({
    name: 'workspace_snapshot',
    description: '返回当前工作目录、记忆数量和一个可修改的示例结果。',
    parameters: { type: 'object', properties: {}, required: [] },
    async execute() {
      const stats = api.memory.stats();
      return {
        workspace: api.workspace,
        memory: stats,
        hint: '这是 plugins/example-tool 的示例工具。修改本文件后点击“重新加载插件”。'
      };
    }
  });
  return {};
}
