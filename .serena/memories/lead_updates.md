# BIZYEET-869 lead update client

The CLI has explicit leads update preview/execute/status adapters. They share the
customer update transport and locked-profile orchestration but hard-code the
canonical leads resource. No caller-selected route or provider bypass is exposed.
Mutation POSTs are not retried after network failures or 401; uncertain execution
is execution_ambiguous and status uses the original preview/key without a receipt.

Lead preview proposed_changes may contain canonical null values; customer preview
validation remains string-only. Lead execution/status permits pipeline_stage but
rejects private resource fields. Status preserves the server's no-retry outcome.
These are source contracts, not evidence of backend deployment or enablement.
The matching backend requires explicit lead-write opt-in and trusted human
approval. Create/conversion and provider parity remain separately unfinished.
