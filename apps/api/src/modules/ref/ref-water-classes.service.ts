import type { RefWaterClassesRepository } from "./ref-water-classes.repo.js";

export class RefWaterClassesService {
    constructor(private readonly repo: RefWaterClassesRepository) {}

    listActiveWaterClasses() {
        return this.repo.listActiveWaterClasses();
    }
}
