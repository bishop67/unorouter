import { Elysia } from "elysia";
import { postsRoute } from "./posts/route";

export const blogDomainRoute = new Elysia({ prefix: "/blog" }).use(postsRoute);
