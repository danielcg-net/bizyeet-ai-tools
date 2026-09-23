# Service reads

- Service CLI transport uses canonical OAuth `/api/agent/services` list/detail through the shared session and credential-rotation boundary; scope `customers.read`.
- Treat IDs, item handles, cursors and `pricing_revision` as server facts. Never reconstruct native IDs or route to provider endpoints.
- Detail can select `items`; list cannot. Project nested items to public id/description/quantity/unit_price only, never costs or catalog linkage.
- Runtime availability and revision/line-handle support depend on the connected server. A public contract declaration is not evidence of backend deployment or authorization to mutate.
