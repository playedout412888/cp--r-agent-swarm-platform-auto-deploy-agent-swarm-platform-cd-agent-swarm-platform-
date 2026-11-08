export const SEED = {
  workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  ownerPrincipalId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  controllerPrincipalId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  credentialId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  projectId: "33333333-3333-4333-8333-333333333333",
  taskDueId: "44444444-4444-4444-8444-444444444441",
  taskBlockedId: "44444444-4444-4444-8444-444444444442",
  taskMissingDateId: "44444444-4444-4444-8444-444444444443",
} as const;

export const WORKFLOW = {
  health: { id: "system.health", version: "1.0.0" },
  dailyBrief: { id: "project.dailyBrief", version: "1.0.0" },
} as const;
