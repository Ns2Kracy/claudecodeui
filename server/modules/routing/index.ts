export {
	routingOAuthCallbackRoutes,
	routingRoutes,
	routingService,
	routingRuntimeService,
	initializeNineRouterDataPlaneKey,
	getNineRouterSidecarStatus,
} from "./routing.module.js";

// Routing composition consumes this factory through the module barrel so callers
// do not deep-import the sidecar health adapter implementation.
export { createNineRouterSidecarService } from "./nine-router-sidecar.service.js";

export type { RoutingModelView } from "../../../shared/routing.js";
