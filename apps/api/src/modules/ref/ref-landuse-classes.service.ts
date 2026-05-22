import type { RefLanduseClassesRepository } from "./ref-landuse-classes.repo.js";

export class RefLanduseClassesService {
    constructor(private readonly repo: RefLanduseClassesRepository) {}

    listActiveLanduseClasses() {
        return this.repo.listActiveLanduseClasses();
    }
}
