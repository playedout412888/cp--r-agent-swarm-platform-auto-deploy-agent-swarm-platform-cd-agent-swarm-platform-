# Contract provenance

**Status:** reconstructed from the Control Plane V1 thread. Not recovered from the original ZIP.

| File | Source |
| --- | --- |
| `command.v1.schema.json` | Copied from the thread command schema (`urn:control-plane:command:v1`) |
| `job.v1.schema.json` | Thread job representation + job-state list |
| `error.v1.schema.json` | Reconstructed; thread required an error contract but did not paste a schema |
| `capability.v1.schema.json` | Thread capability manifest example |
| `workflow.v1.schema.json` | Reconstructed from the health and daily-brief step lists |
| `health-result.v1.schema.json` | Reconstructed for the health workflow result |
| `daily-brief-result.v1.schema.json` | Reconstructed from the daily-brief fact/validation rules |
| `openapi.yaml` | Reconstructed OpenAPI 3.1 for the nine operations listed in the thread |

Pushcut appears only as a later adapter enum value and an unconfigured connection. Gate A does not implement or call it.
