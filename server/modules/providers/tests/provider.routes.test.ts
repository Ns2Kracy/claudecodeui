import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";

import express from "express";

import providerRouter from "@/modules/providers/provider.routes.js";
import { AppError } from "@/shared/utils.js";

async function withProviderServer(run: (baseUrl: string) => Promise<void>) {
	const app = express();
	app.use(express.json());
	app.use("/api/providers", providerRouter);
	app.use(
		(
			error: unknown,
			_request: express.Request,
			response: express.Response,
			_next: express.NextFunction,
		) => {
			if (error instanceof AppError) {
				response.status(error.statusCode).json({
					success: false,
					error: { code: error.code, message: error.message },
				});
				return;
			}
			response.status(500).json({ success: false });
		},
	);

	const server = http.createServer(app);
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	try {
		const address = server.address();
		assert.equal(typeof address, "object");
		await run(`http://127.0.0.1:${(address as { port: number }).port}`);
	} finally {
		server.close();
		await once(server, "close");
	}
}

test("provider routes reject removed coding agents at the HTTP boundary", async () => {
	await withProviderServer(async (baseUrl) => {
		for (const provider of ["claude", "cursor", "opencode"]) {
			const response = await fetch(
				`${baseUrl}/api/providers/${provider}/capabilities`,
			);
			assert.equal(response.status, 400);
			const body = (await response.json()) as {
				error?: { code?: string };
			};
			assert.equal(body.error?.code, "UNSUPPORTED_PROVIDER");
		}
	});
});
