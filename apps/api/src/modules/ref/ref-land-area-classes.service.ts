import type { RefLandAreaClassesRepository } from "./ref-land-area-classes.repo.js";

export class RefLandAreaClassesService {
    constructor(private readonly repo: RefLandAreaClassesRepository) {}

    listActiveLandAreaClasses() {
        return this.repo.listActiveLandAreaClasses();
    }
}
