export namespace main {
	
	export class EntropyLog {
	    level: string;
	    message: string;
	    target: string;
	
	    static createFrom(source: any = {}) {
	        return new EntropyLog(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.level = source["level"];
	        this.message = source["message"];
	        this.target = source["target"];
	    }
	}
	export class EncryptionResult {
	    generatedKey: string;
	    entropyLogs: EntropyLog[];
	
	    static createFrom(source: any = {}) {
	        return new EncryptionResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.generatedKey = source["generatedKey"];
	        this.entropyLogs = this.convertValues(source["entropyLogs"], EntropyLog);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class FileSelection {
	    path: string;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new FileSelection(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.name = source["name"];
	    }
	}

}

