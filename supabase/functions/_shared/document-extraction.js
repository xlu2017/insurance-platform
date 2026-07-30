// This file is generated from packages/document-extraction. Do not edit manually.
// source-hash: ddc3cfdf57cd4215297ab5c4577db1ddcd782faa3b6ccc07b56d272a7dbc300f


// ../../node_modules/zod/lib/index.mjs
var util;
(function(util2) {
  util2.assertEqual = (val) => val;
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
        fieldErrors[sub.path[0]].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var overrideErrorMap = errorMap;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === errorMap ? void 0 : errorMap
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;
function __classPrivateFieldGet(receiver, state, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}
function __classPrivateFieldSet(receiver, state, value, kind, f) {
  if (kind === "m") throw new TypeError("Private method is not writable");
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
}
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message === null || message === void 0 ? void 0 : message.message;
})(errorUtil || (errorUtil = {}));
var _ZodEnum_cache;
var _ZodNativeEnum_cache;
var ParseInputLazyPath = class {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (this._key instanceof Array) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result2) => {
  if (isValid(result2)) {
    return { success: true, data: result2.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    var _a, _b;
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message !== null && message !== void 0 ? message : ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: (_a = message !== null && message !== void 0 ? message : required_error) !== null && _a !== void 0 ? _a : ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: (_b = message !== null && message !== void 0 ? message : invalid_type_error) !== null && _b !== void 0 ? _b : ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result2 = this._parse(input);
    if (isAsync(result2)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result2;
  }
  _parseAsync(input) {
    const result2 = this._parse(input);
    return Promise.resolve(result2);
  }
  parse(data, params) {
    const result2 = this.safeParse(data, params);
    if (result2.success)
      return result2.data;
    throw result2.error;
  }
  safeParse(data, params) {
    var _a;
    const ctx = {
      common: {
        issues: [],
        async: (_a = params === null || params === void 0 ? void 0 : params.async) !== null && _a !== void 0 ? _a : false,
        contextualErrorMap: params === null || params === void 0 ? void 0 : params.errorMap
      },
      path: (params === null || params === void 0 ? void 0 : params.path) || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result2 = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result2);
  }
  "~validate"(data) {
    var _a, _b;
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result2 = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result2) ? {
          value: result2.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if ((_b = (_a = err === null || err === void 0 ? void 0 : err.message) === null || _a === void 0 ? void 0 : _a.toLowerCase()) === null || _b === void 0 ? void 0 : _b.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result2) => isValid(result2) ? {
      value: result2.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result2 = await this.safeParseAsync(data, params);
    if (result2.success)
      return result2.data;
    throw result2.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params === null || params === void 0 ? void 0 : params.errorMap,
        async: true
      },
      path: (params === null || params === void 0 ? void 0 : params.path) || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result2 = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result2);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result2 = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result2 instanceof Promise) {
        return result2.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result2) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let regex = `([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d`;
  if (args.precision) {
    regex = `${regex}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    regex = `${regex}(\\.\\d+)?`;
  }
  return regex;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if (!decoded.typ || !decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch (_a) {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch (_a) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    var _a, _b;
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof (options === null || options === void 0 ? void 0 : options.precision) === "undefined" ? null : options === null || options === void 0 ? void 0 : options.precision,
      offset: (_a = options === null || options === void 0 ? void 0 : options.offset) !== null && _a !== void 0 ? _a : false,
      local: (_b = options === null || options === void 0 ? void 0 : options.local) !== null && _b !== void 0 ? _b : false,
      ...errorUtil.errToObj(options === null || options === void 0 ? void 0 : options.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof (options === null || options === void 0 ? void 0 : options.precision) === "undefined" ? null : options === null || options === void 0 ? void 0 : options.precision,
      ...errorUtil.errToObj(options === null || options === void 0 ? void 0 : options.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options === null || options === void 0 ? void 0 : options.position,
      ...errorUtil.errToObj(options === null || options === void 0 ? void 0 : options.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  var _a;
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: (_a = params === null || params === void 0 ? void 0 : params.coerce) !== null && _a !== void 0 ? _a : false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / Math.pow(10, decCount);
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null, min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: (params === null || params === void 0 ? void 0 : params.coerce) || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch (_a) {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  var _a;
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: (_a = params === null || params === void 0 ? void 0 : params.coerce) !== null && _a !== void 0 ? _a : false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: (params === null || params === void 0 ? void 0 : params.coerce) || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: (params === null || params === void 0 ? void 0 : params.coerce) || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result3) => {
        return ParseStatus.mergeArray(status, result3);
      });
    }
    const result2 = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result2);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    return this._cached = { shape, keys };
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") ;
      else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          var _a, _b, _c, _d;
          const defaultError = (_c = (_b = (_a = this._def).errorMap) === null || _b === void 0 ? void 0 : _b.call(_a, issue, ctx).message) !== null && _c !== void 0 ? _c : ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: (_d = errorUtil.errToObj(message).message) !== null && _d !== void 0 ? _d : defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    util.objectKeys(mask).forEach((key) => {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    });
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    util.objectKeys(this.shape).forEach((key) => {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    });
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    util.objectKeys(this.shape).forEach((key) => {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    });
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    util.objectKeys(this.shape).forEach((key) => {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    });
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result2 of results) {
        if (result2.result.status === "valid") {
          return result2.result;
        }
      }
      for (const result2 of results) {
        if (result2.result.status === "dirty") {
          ctx.common.issues.push(...result2.ctx.common.issues);
          return result2.result;
        }
      }
      const unionErrors = results.map((result2) => new ZodError(result2.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result2 = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result2.status === "valid") {
          return result2;
        } else if (result2.status === "dirty" && !dirty) {
          dirty = { result: result2, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [
          ctx.common.contextualErrorMap,
          ctx.schemaErrorMap,
          getErrorMap(),
          errorMap
        ].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [
          ctx.common.contextualErrorMap,
          ctx.schemaErrorMap,
          getErrorMap(),
          errorMap
        ].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result2 = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result2, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result2, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result2 = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result2, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result2, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  constructor() {
    super(...arguments);
    _ZodEnum_cache.set(this, void 0);
  }
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!__classPrivateFieldGet(this, _ZodEnum_cache, "f")) {
      __classPrivateFieldSet(this, _ZodEnum_cache, new Set(this._def.values), "f");
    }
    if (!__classPrivateFieldGet(this, _ZodEnum_cache, "f").has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
_ZodEnum_cache = /* @__PURE__ */ new WeakMap();
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  constructor() {
    super(...arguments);
    _ZodNativeEnum_cache.set(this, void 0);
  }
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!__classPrivateFieldGet(this, _ZodNativeEnum_cache, "f")) {
      __classPrivateFieldSet(this, _ZodNativeEnum_cache, new Set(util.getValidEnumValues(this._def.values)), "f");
    }
    if (!__classPrivateFieldGet(this, _ZodNativeEnum_cache, "f").has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
_ZodNativeEnum_cache = /* @__PURE__ */ new WeakMap();
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result2 = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result2.status === "aborted")
            return INVALID;
          if (result2.status === "dirty")
            return DIRTY(result2.value);
          if (status.value === "dirty")
            return DIRTY(result2.value);
          return result2;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result2 = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result2.status === "aborted")
          return INVALID;
        if (result2.status === "dirty")
          return DIRTY(result2.value);
        if (status.value === "dirty")
          return DIRTY(result2.value);
        return result2;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result2 = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result2);
        }
        if (result2 instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return base;
        const result2 = effect.transform(base.value, checkCtx);
        if (result2 instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result2 };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return base;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result2) => ({ status: status.value, value: result2 }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result2 = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result2)) {
      return result2.then((result3) => {
        return {
          status: "valid",
          value: result3.status === "valid" ? result3.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result2.status === "valid" ? result2.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = /* @__PURE__ */ Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result2 = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result2) ? result2.then((data) => freeze(data)) : freeze(result2);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function custom(check, params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      var _a, _b;
      if (!check(data)) {
        const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
        const _fatal = (_b = (_a = p.fatal) !== null && _a !== void 0 ? _a : fatal) !== null && _b !== void 0 ? _b : true;
        const p2 = typeof p === "string" ? { message: p } : p;
        ctx.addIssue({ code: "custom", ...p2, fatal: _fatal });
      }
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;
var z = /* @__PURE__ */ Object.freeze({
  __proto__: null,
  defaultErrorMap: errorMap,
  setErrorMap,
  getErrorMap,
  makeIssue,
  EMPTY_PATH,
  addIssueToContext,
  ParseStatus,
  INVALID,
  DIRTY,
  OK,
  isAborted,
  isDirty,
  isValid,
  isAsync,
  get util() {
    return util;
  },
  get objectUtil() {
    return objectUtil;
  },
  ZodParsedType,
  getParsedType,
  ZodType,
  datetimeRegex,
  ZodString,
  ZodNumber,
  ZodBigInt,
  ZodBoolean,
  ZodDate,
  ZodSymbol,
  ZodUndefined,
  ZodNull,
  ZodAny,
  ZodUnknown,
  ZodNever,
  ZodVoid,
  ZodArray,
  ZodObject,
  ZodUnion,
  ZodDiscriminatedUnion,
  ZodIntersection,
  ZodTuple,
  ZodRecord,
  ZodMap,
  ZodSet,
  ZodFunction,
  ZodLazy,
  ZodLiteral,
  ZodEnum,
  ZodNativeEnum,
  ZodPromise,
  ZodEffects,
  ZodTransformer: ZodEffects,
  ZodOptional,
  ZodNullable,
  ZodDefault,
  ZodCatch,
  ZodNaN,
  BRAND,
  ZodBranded,
  ZodPipeline,
  ZodReadonly,
  custom,
  Schema: ZodType,
  ZodSchema: ZodType,
  late,
  get ZodFirstPartyTypeKind() {
    return ZodFirstPartyTypeKind;
  },
  coerce,
  any: anyType,
  array: arrayType,
  bigint: bigIntType,
  boolean: booleanType,
  date: dateType,
  discriminatedUnion: discriminatedUnionType,
  effect: effectsType,
  "enum": enumType,
  "function": functionType,
  "instanceof": instanceOfType,
  intersection: intersectionType,
  lazy: lazyType,
  literal: literalType,
  map: mapType,
  nan: nanType,
  nativeEnum: nativeEnumType,
  never: neverType,
  "null": nullType,
  nullable: nullableType,
  number: numberType,
  object: objectType,
  oboolean,
  onumber,
  optional: optionalType,
  ostring,
  pipeline: pipelineType,
  preprocess: preprocessType,
  promise: promiseType,
  record: recordType,
  set: setType,
  strictObject: strictObjectType,
  string: stringType,
  symbol: symbolType,
  transformer: effectsType,
  tuple: tupleType,
  "undefined": undefinedType,
  union: unionType,
  unknown: unknownType,
  "void": voidType,
  NEVER,
  ZodIssueCode,
  quotelessJson,
  ZodError
});

// src/types.ts
var ExtractedPdfImageSchema = z.object({
  mimeType: z.string().min(1),
  base64: z.string().min(1)
}).strict();
var ExtractedPdfPage = z.object({
  pageNumber: z.number().int().positive(),
  text: z.string(),
  image: ExtractedPdfImageSchema.optional(),
  items: z.array(
    z.object({
      text: z.string(),
      x: z.number().optional(),
      y: z.number().optional()
    }).strict()
  ).optional()
}).strict();
var ExtractedPdf = z.object({
  documentId: z.string(),
  fileDigest: z.string(),
  pageCount: z.number().int().nonnegative(),
  pages: z.array(ExtractedPdfPage)
}).strict();
var AuthorityLevel = z.enum([
  "coverage_summary",
  "insurance_certificate",
  "active_endorsement",
  "endorsement",
  "invoice",
  "renewal_overview",
  "notice",
  "informational_notice",
  "policy_wording",
  "header_footer",
  "unknown"
]);
var AddressRole = z.enum([
  "insured_location",
  "mailing_address",
  "mortgagee_address",
  "agency_address",
  "payment_address",
  "unknown"
]);
var ExtractedCoveragePresence = z.enum([
  "included",
  "not_included",
  "unknown",
  "not_applicable"
]);
var ExtractedFactAssertion = z.object({
  id: z.string().min(1),
  documentId: z.string(),
  pageNumber: z.number().int().positive(),
  entityScope: z.enum(["policy", "property", "vehicle", "coverage", "premium", "notice"]),
  fieldPath: z.string(),
  rawText: z.string(),
  parsedValue: z.unknown(),
  normalizedValue: z.unknown(),
  parserId: z.string(),
  parserVersion: z.string(),
  confidence: z.number().min(0).max(1),
  authority: AuthorityLevel,
  addressRole: AddressRole.optional(),
  coveragePresence: ExtractedCoveragePresence.optional()
}).strict();
var ParsedInsurer = z.object({
  name: z.string(),
  address: z.string().optional()
}).strict();
var ParsedAgency = z.object({
  name: z.string(),
  address: z.string().optional(),
  phone: z.string().optional()
}).strict();
var ParsedPolicyTerm = z.object({
  effectiveDate: z.string().optional(),
  expiryDate: z.string().optional(),
  policyNumber: z.string().optional(),
  annualPremiumCents: z.number().int().nonnegative().optional()
}).strict();
var ParsedAssetAssertion = z.object({
  assetType: z.enum(["property", "vehicle"]),
  identityFingerprint: z.string(),
  displayLabel: z.string(),
  matchClassification: z.enum([
    "new",
    "exact_existing_match",
    "possible_existing_match",
    "new_identity_confirmation_required"
  ]).optional(),
  occupancy: z.enum(["principal_residence", "rental", "unknown"]).optional(),
  assertions: z.array(ExtractedFactAssertion)
}).strict();
var ParsedCoverageAssertion = ExtractedFactAssertion;
var ParsedConflict = z.object({
  fieldPath: z.string(),
  assertionIds: z.array(z.string().min(1)),
  selectedAssertionId: z.string().min(1).optional(),
  reason: z.string()
}).strict();
var PolicyNoticeKind = z.enum([
  "future_coverage_change",
  "coverage_available_for_purchase",
  "eligibility_notice",
  "general_explanation",
  "customer_action_required",
  "renewal_information"
]);
var ParsedPolicyNotice = z.object({
  kind: PolicyNoticeKind,
  fieldPath: z.string().optional(),
  text: z.string(),
  pageNumber: z.number().int().positive(),
  authority: AuthorityLevel,
  assertionId: z.string().min(1).optional()
}).strict();
var ParsedInsuranceDocument = z.object({
  classification: z.enum(["home_policy_renewal", "auto_policy_renewal", "unsupported"]),
  documentId: z.string().optional(),
  fileDigest: z.string().optional(),
  insurer: ParsedInsurer.optional(),
  agency: ParsedAgency.optional(),
  policyTerms: z.array(ParsedPolicyTerm).default([]),
  assertions: z.array(ExtractedFactAssertion).default([]),
  selectedAssertions: z.record(z.string(), z.string()).default({}),
  conflicts: z.array(ParsedConflict).default([]),
  notices: z.array(ParsedPolicyNotice).default([]),
  assetAssertions: z.array(ParsedAssetAssertion).default([]),
  coverageAssertions: z.array(ParsedCoverageAssertion).default([]),
  parserId: z.string(),
  parserVersion: z.string(),
  pageCount: z.number().int().nonnegative().default(0)
}).strict();

// src/parsers/ids.ts
function formatUuid(bytes) {
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
async function deterministicId(seed) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed))
  ).slice(0, 16);
  return formatUuid(digest);
}
async function assertionId(input) {
  const seed = [
    input.fileDigest,
    input.parserId,
    input.parserVersion,
    String(input.pageNumber),
    input.fieldPath,
    String(input.occurrenceIndex),
    JSON.stringify(input.normalizedValue)
  ].join("|");
  return deterministicId(seed);
}

// src/parsers/helpers.ts
function normalizePostalCode(input) {
  const m = input.toUpperCase().replace(/\s+/g, "").match(/^[A-Z]\d[A-Z]\d[A-Z]\d$/);
  if (!m) return void 0;
  const c = m[0];
  return `${c.slice(0, 3)} ${c.slice(3)}`;
}
function normalizeProvince(input) {
  const map = {
    AB: "AB",
    ALBERTA: "AB",
    BC: "BC",
    ON: "ON",
    ONTARIO: "ON",
    QC: "QC",
    QUEBEC: "QC"
  };
  const key = input.trim().toUpperCase();
  return map[key];
}
function normalizeVin(input) {
  const stripped = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (stripped.length !== 17) return null;
  if (/[IOQ]/.test(stripped)) return null;
  const display = `${stripped.slice(0, 4)}\u2022\u2022\u2022\u2022${stripped.slice(stripped.length - 4)}`;
  return { normalized: stripped, display };
}
function parseMoneyCents(input) {
  const cleaned = input.replace(/[\s,]/g, "").replace(/^\$/, "");
  if (!cleaned || cleaned === "0") return 0;
  const n = Number.parseFloat(cleaned);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
}
function parseDateIso(input) {
  const iso = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = input.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (!m) return null;
  const monthNames = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december"
  ];
  const month = monthNames.indexOf(m[1].toLowerCase()) + 1;
  if (month === 0) return null;
  const day = m[2].padStart(2, "0");
  const year = m[3];
  return `${year}-${month.toString().padStart(2, "0")}-${day}`;
}
function splitLines(text) {
  return text.split(/\r?\n/);
}

// src/parsers/authority.ts
var AUTHORITY_RANK = {
  coverage_summary: 0,
  insurance_certificate: 1,
  active_endorsement: 2,
  endorsement: 2,
  invoice: 3,
  renewal_overview: 4,
  notice: 5,
  informational_notice: 5,
  policy_wording: 5,
  header_footer: 6,
  unknown: 7
};
function authorityRank(authority) {
  return AUTHORITY_RANK[authority] ?? AUTHORITY_RANK.unknown;
}
function compareAssertionAuthority(a, b) {
  return authorityRank(a.authority) - authorityRank(b.authority);
}

// src/parsers/resolve.ts
function resolveByAuthority(assertions) {
  const byPath = {};
  for (const a of assertions) {
    byPath[a.fieldPath] = byPath[a.fieldPath] ?? [];
    byPath[a.fieldPath].push(a);
  }
  const selected = {};
  const conflicts = [];
  for (const [fieldPath, list] of Object.entries(byPath)) {
    const sorted = [...list].sort(compareAssertionAuthority);
    const distinctValues = [...new Set(sorted.map((a) => JSON.stringify(a.normalizedValue)))];
    if (distinctValues.length <= 1) {
      selected[fieldPath] = sorted[0];
      continue;
    }
    const topAuthority = sorted[0].authority;
    const topGroup = sorted.filter((a) => a.authority === topAuthority);
    const topDistinct = [...new Set(topGroup.map((a) => JSON.stringify(a.normalizedValue)))].length;
    if (topDistinct === 1) {
      selected[fieldPath] = topGroup[0];
    }
    const selectedId = topDistinct === 1 ? topGroup[0].id : void 0;
    const authorities = [...new Set(sorted.map((a) => a.authority))].join(", ");
    conflicts.push({
      fieldPath,
      assertionIds: sorted.map((a) => a.id),
      selectedAssertionId: selectedId,
      reason: `Conflicting values across ${authorities}; ${selectedId ? `selected ${topGroup[0].authority}` : "equal authority tie requires review"}.`
    });
  }
  return { selected, conflicts };
}
function selectedValues(selected) {
  return Object.values(selected);
}

// src/parsers/td-home.ts
var ID = "TdSecurityNationalHomeRenewalParserV1";
var VERSION = "1.0.0";
function canParseHome(document) {
  const text = document.pages.map((p) => p.text).join("\n").toLowerCase();
  return text.includes("security national insurance company") && text.includes("home insurance") && (text.includes("your rental home package") || text.includes("your homeowner package"));
}
var directionTokens = /* @__PURE__ */ new Set(["N", "S", "E", "W", "NW", "NE", "SW", "SE"]);
function detectPageAuthority(text) {
  const t = text.toLowerCase();
  const hasCoverageLines = /coverage\s+[a-z]\s*[-–]\s*.+?:/i.test(text);
  const hasPackageSolution = /million\s+solution/i.test(text);
  const isPackageOrSummary = t.includes("coverage summary page") || t.includes("your rental home package") || t.includes("your homeowner package");
  if (t.includes("insurance issued by") || t.includes("certificate of insurance") || t.includes("insurance certificate")) {
    return "insurance_certificate";
  }
  if (isPackageOrSummary && (hasCoverageLines || hasPackageSolution)) return "coverage_summary";
  if (t.includes("endorsement")) return "active_endorsement";
  if (t.includes("invoice")) return "invoice";
  if (t.includes("overview of your") && t.includes("renewal")) return "renewal_overview";
  if (t.includes("important information") || t.includes("updates to your coverage") || t.includes("changes to your coverage")) {
    return "notice";
  }
  if (t.includes("notice")) return "notice";
  return "header_footer";
}
function nextNonEmpty(lines, start, max = 5) {
  for (let i = 1; i <= max && start + i < lines.length; i++) {
    const v = lines[start + i].trim();
    if (v.length > 0) return v;
  }
  return null;
}
function parseTermRange(text) {
  const m = text.match(/(\d{4}-\d{2}-\d{2})\s*(?:to|-|–)\s*(\d{4}-\d{2}-\d{2})/);
  if (m) {
    return { effective: m[1], expiry: m[2] };
  }
  const m2 = text.match(/([A-Za-z]+\s+\d{1,2},?\s+\d{4})\s*[-–]\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/);
  if (m2) {
    return {
      effective: parseDateIso(m2[1]) ?? void 0,
      expiry: parseDateIso(m2[2]) ?? void 0
    };
  }
  return {};
}
function isPolicyNumberCandidate(value) {
  const cleaned = value.replace(/\s/g, "");
  if (cleaned.length === 0) return false;
  if (!/^\d+$/.test(cleaned)) return false;
  if (cleaned.length < 4) return false;
  return true;
}
function findPolicyNumber(lines, start) {
  for (let i = 1; i <= 4 && start + i < lines.length; i++) {
    const v = lines[start + i].trim();
    if (v.length === 0) continue;
    if (isPolicyNumberCandidate(v)) return v.replace(/\s/g, "");
  }
  return null;
}
function stripAddressRolePrefix(s) {
  return s.replace(
    /^(?:YOUR\s+)?(?:RENTAL\s+HOME|HOMEOWNER(?:,\s*PRINCIPAL\s+RESIDENCE)?|PRINCIPAL\s+RESIDENCE)\s*(?:PACKAGE)?\s*[:\s-]+\s*/i,
    ""
  ).trim();
}
function parseAddressParts(text) {
  const m = text.match(
    /^(.*?)\s*,?\s*([A-Za-z][A-Za-z\s]{1,40}?)\s+(AB|BC|ON|QC)\s+([A-Z]\d[A-Z]\s?\d[A-Z]\d)/i
  );
  if (!m) return null;
  return {
    beforeCity: m[1].trim(),
    city: m[2].trim().replace(/,\s*$/, "").trim(),
    province: m[3].toUpperCase(),
    postalCode: m[4].toUpperCase().replace(/\s/g, "")
  };
}
function isRedactedStreet(street) {
  if (!street) return true;
  const cleaned = street.replace(/[^A-Za-z0-9]/g, " ").trim();
  if (cleaned.length < 2) return true;
  if (/placeholder|redacted|removed|xxxx|\*+|0000|•/.test(cleaned.toLowerCase())) return true;
  const tokens = cleaned.split(/\s+/).filter((w) => !directionTokens.has(w.toUpperCase()));
  if (tokens.length === 0) return true;
  const hasWord = tokens.some((w) => /^[A-Za-z]{2,}$/.test(w));
  const hasNumber = tokens.some((w) => /\d/.test(w));
  if (!hasWord && !hasNumber) return true;
  if (!hasWord) return true;
  return false;
}
function detectAddressRole(lines, i) {
  const prev = lines[i - 1]?.trim() ?? "";
  const lowerPrev = prev.toLowerCase();
  const lowerCurr = lines[i].toLowerCase();
  if (lowerPrev.includes("your rental home package") || lowerCurr.startsWith("rental home") || lowerPrev.startsWith("rental home")) {
    return "insured_location";
  }
  if (lowerPrev.includes("your homeowner package") || lowerCurr.startsWith("homeowner") || lowerCurr.startsWith("principal residence") || lowerPrev.startsWith("homeowner") || lowerPrev.startsWith("principal residence")) {
    return "insured_location";
  }
  if (lowerCurr.includes("mortgagee") || lowerPrev.includes("mortgagee"))
    return "mortgagee_address";
  if (lowerCurr.includes("payment") || lowerPrev.includes("payment")) return "payment_address";
  if (lowerCurr.includes("agency")) return "agency_address";
  if (i < 4) {
    const lookahead = lines.slice(i + 1, i + 6).join(" ");
    if (/Page\s+\d+\s+of/i.test(lookahead)) return "mailing_address";
  }
  return null;
}
function addressLabelOccupancy(role, line, prev) {
  if (role !== "insured_location") return void 0;
  const sources = [line, prev ?? ""].map((s) => s.toLowerCase());
  for (const lower of sources) {
    if (lower.includes("rental home")) return "rental";
    if (lower.includes("homeowner") || lower.includes("principal residence"))
      return "principal_residence";
  }
  return void 0;
}
function fieldForCoverageLabel(label) {
  const l = label.toLowerCase();
  if (l.includes("dwelling building")) return "property.dwellingLimitCents";
  if (l.includes("personal property")) return "property.contentsLimitCents";
  if (l.includes("fair rental value") || l.includes("additional living expenses")) {
    return "property.fairRentalValueLimitCents";
  }
  if (l.includes("legal liability")) return "property.personalLiabilityLimitCents";
  if (l.includes("voluntary medical")) return "property.voluntaryMedicalLimitCents";
  if (l.includes("voluntary payment for damage to property")) {
    return "property.voluntaryPropertyDamageLimitCents";
  }
  return null;
}
function coveragePresenceFromRest(rest, amount) {
  const lower = rest.toLowerCase();
  if (lower.includes("not covered") || lower.includes("not included")) return "not_included";
  if (lower.includes("not applicable")) return "not_applicable";
  if (lower.includes("included")) return "included";
  if (amount !== null && amount > 0) return "included";
  if (lower.includes("unknown") || lower.includes("not shown")) return "unknown";
  return "unknown";
}
function extractNoticeKind(line, next) {
  const text = `${line} ${next}`.toLowerCase();
  if (text.includes("will change in the future") || text.includes("will now appear") || text.includes("will be eligible")) {
    return "future_coverage_change";
  }
  if (text.includes("available to purchase") || text.includes("contact us to add") || text.includes("consider this coverage") || text.includes("to purchase this coverage")) {
    return "coverage_available_for_purchase";
  }
  if (text.includes("may be eligible")) return "eligibility_notice";
  if (text.includes("please contact us") || text.includes("call us") || text.includes("reach out to")) {
    return "customer_action_required";
  }
  if (text.includes("if you do nothing") && text.includes("policy will renew"))
    return "renewal_information";
  if (text.includes("general description") || text.includes("this is not a complete description")) {
    return "general_explanation";
  }
  return null;
}
function normalizeAddress(input) {
  return input.toUpperCase().replace(/,/g, " ").replace(/\s+/g, " ").replace(/\bSTREET\b/g, "ST").replace(/\bAVENUE\b/g, "AVE").replace(/\bDRIVE\b/g, "DR").replace(/\bROAD\b/g, "RD").replace(/\bCOURT\b/g, "CT").replace(/\bNORTH\b/g, "N").replace(/\bSOUTH\b/g, "S").replace(/\bEAST\b/g, "E").replace(/\bWEST\b/g, "W").trim();
}
async function parseHome(document) {
  const allAssertions = [];
  const allNotices = [];
  const occurrenceIndex = /* @__PURE__ */ new Map();
  async function makeAssertion(fields) {
    const key = fields.fieldPath;
    const idx = occurrenceIndex.get(key) ?? 0;
    occurrenceIndex.set(key, idx + 1);
    const id = await assertionId({
      fileDigest: document.fileDigest,
      parserId: ID,
      parserVersion: VERSION,
      pageNumber: fields.pageNumber,
      fieldPath: fields.fieldPath,
      occurrenceIndex: idx,
      normalizedValue: fields.normalizedValue
    });
    return {
      id,
      parserId: ID,
      parserVersion: VERSION,
      ...fields
    };
  }
  for (const page of document.pages) {
    const lines = splitLines(page.text);
    const authority = detectPageAuthority(page.text);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lower = line.toLowerCase();
      if (lower.startsWith("renewal date")) {
        const val = nextNonEmpty(lines, i);
        if (val) {
          const date = parseDateIso(val);
          if (date) {
            allAssertions.push(
              await makeAssertion({
                documentId: document.documentId,
                pageNumber: page.pageNumber,
                entityScope: "policy",
                fieldPath: "policy.renewalDate",
                rawText: val,
                parsedValue: date,
                normalizedValue: date,
                confidence: 0.9,
                authority
              })
            );
          }
        }
      }
      if (lower.startsWith("term of your coverage")) {
        const next = nextNonEmpty(lines, i);
        const after = nextNonEmpty(lines, i + 1);
        const range = parseTermRange(`${next ?? ""} ${after ?? ""}`);
        if (range.effective) {
          allAssertions.push(
            await makeAssertion({
              documentId: document.documentId,
              pageNumber: page.pageNumber,
              entityScope: "policy",
              fieldPath: "policy.effectiveDate",
              rawText: `${next ?? ""} ${after ?? ""}`,
              parsedValue: range.effective,
              normalizedValue: range.effective,
              confidence: 0.95,
              authority
            })
          );
        }
        if (range.expiry) {
          allAssertions.push(
            await makeAssertion({
              documentId: document.documentId,
              pageNumber: page.pageNumber,
              entityScope: "policy",
              fieldPath: "policy.expiryDate",
              rawText: `${next ?? ""} ${after ?? ""}`,
              parsedValue: range.expiry,
              normalizedValue: range.expiry,
              confidence: 0.95,
              authority
            })
          );
        }
      }
      if (lower.startsWith("policy number")) {
        const val = findPolicyNumber(lines, i);
        if (val) {
          allAssertions.push(
            await makeAssertion({
              documentId: document.documentId,
              pageNumber: page.pageNumber,
              entityScope: "policy",
              fieldPath: "policy.policyNumber",
              rawText: val,
              parsedValue: val,
              normalizedValue: val,
              confidence: val === "0000" ? 0.3 : 0.9,
              authority
            })
          );
        }
      }
      if (lower.includes("your term premium") || lower.includes("your total term premium")) {
        const m = line.match(/\$([\d,]+(?:\.\d{2})?)/);
        if (m) {
          const cents = parseMoneyCents(m[0]);
          if (cents !== null) {
            allAssertions.push(
              await makeAssertion({
                documentId: document.documentId,
                pageNumber: page.pageNumber,
                entityScope: "premium",
                fieldPath: "policy.annualPremiumCents",
                rawText: m[0],
                parsedValue: cents,
                normalizedValue: cents,
                confidence: 0.9,
                authority
              })
            );
          }
        }
      }
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const parsed = parseAddressParts(line);
      if (!parsed) continue;
      const role = detectAddressRole(lines, i);
      if (!role) continue;
      const streetRaw = stripAddressRolePrefix(parsed.beforeCity);
      const redacted = isRedactedStreet(streetRaw);
      const province2 = normalizeProvince(parsed.province);
      const postalCode2 = normalizePostalCode(parsed.postalCode);
      const city2 = parsed.city.toUpperCase() === "CALGARY" ? "Calgary" : parsed.city;
      if (postalCode2) {
        allAssertions.push(
          await makeAssertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "property",
            fieldPath: "property.postalCode",
            rawText: parsed.postalCode,
            parsedValue: postalCode2,
            normalizedValue: postalCode2,
            confidence: redacted ? 0.5 : 0.95,
            authority,
            addressRole: role
          })
        );
      }
      if (province2) {
        allAssertions.push(
          await makeAssertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "property",
            fieldPath: "property.province",
            rawText: parsed.province,
            parsedValue: province2,
            normalizedValue: province2,
            confidence: redacted ? 0.5 : 0.95,
            authority,
            addressRole: role
          })
        );
      }
      if (city2) {
        allAssertions.push(
          await makeAssertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "property",
            fieldPath: "property.city",
            rawText: city2,
            parsedValue: city2,
            normalizedValue: city2,
            confidence: redacted ? 0.5 : 0.95,
            authority,
            addressRole: role
          })
        );
      }
      if (streetRaw) {
        allAssertions.push(
          await makeAssertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "property",
            fieldPath: "property.streetAddress",
            rawText: streetRaw,
            parsedValue: streetRaw,
            normalizedValue: streetRaw,
            confidence: redacted ? 0.4 : 0.95,
            authority,
            addressRole: role
          })
        );
      }
      const occupancy2 = addressLabelOccupancy(role, line, lines[i - 1]);
      if (occupancy2 && role === "insured_location") {
        allAssertions.push(
          await makeAssertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "property",
            fieldPath: "property.occupancy",
            rawText: occupancy2,
            parsedValue: occupancy2,
            normalizedValue: occupancy2,
            confidence: 0.95,
            authority
          })
        );
      }
    }
    let packageLimitCents;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (/million\s+solution/i.test(line)) {
        const nextText = lines.slice(i + 1, i + 6).join(" ");
        const m = nextText.match(/\$([\d,]+(?:\.\d{2})?)/);
        if (m) packageLimitCents = parseMoneyCents(m[0]) ?? void 0;
      }
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lower = line.toLowerCase();
      const covMatch = line.match(/^Coverage\s+([A-Z])\s*[-–]\s*(.+?)\s*:\s*(.*)$/i);
      if (covMatch) {
        const label = covMatch[2].trim();
        const rest = covMatch[3].trim();
        const fieldPath = fieldForCoverageLabel(label);
        if (!fieldPath) continue;
        const amount = parseMoneyCents(rest);
        let presence = coveragePresenceFromRest(rest, amount);
        let value = amount;
        if (fieldPath === "property.dwellingLimitCents" && packageLimitCents && (presence === "included" || amount === null)) {
          value = packageLimitCents;
          presence = "included";
        }
        if (amount !== null && amount > 0) {
          value = amount;
        } else if (presence === "included") {
          value = null;
        } else {
          value = null;
        }
        allAssertions.push(
          await makeAssertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "coverage",
            fieldPath,
            rawText: line,
            parsedValue: value,
            normalizedValue: value,
            confidence: 0.9,
            authority,
            coveragePresence: presence
          })
        );
      }
      if (lower.startsWith("base deductible")) {
        const next = nextNonEmpty(lines, i);
        if (next) {
          const val = parseMoneyCents(next);
          if (val !== null) {
            allAssertions.push(
              await makeAssertion({
                documentId: document.documentId,
                pageNumber: page.pageNumber,
                entityScope: "coverage",
                fieldPath: "property.baseDeductibleCents",
                rawText: next,
                parsedValue: val,
                normalizedValue: val,
                confidence: 0.9,
                authority
              })
            );
          }
        }
      }
      const windHailMatch = lower.match(/^wind\s*(?:and|&|\/)\s*hail\s*deductible/i) || lower.match(/windstorm.*hail.*deductible/i);
      if (windHailMatch) {
        const next = nextNonEmpty(lines, i);
        if (next) {
          const val = parseMoneyCents(next);
          if (val !== null) {
            allAssertions.push(
              await makeAssertion({
                documentId: document.documentId,
                pageNumber: page.pageNumber,
                entityScope: "coverage",
                fieldPath: "property.windHailDeductibleCents",
                rawText: next,
                parsedValue: val,
                normalizedValue: val,
                confidence: 0.9,
                authority
              })
            );
          }
        }
      }
      if (lower.match(/^windstorm:/i) || lower.match(/^hail:/i)) {
        const searchText = lines.slice(i, i + 6).join(" ");
        const m = searchText.match(/Deductible:\s*\$([\d,]+(?:\.\d{2})?)/i);
        if (m) {
          const val = parseMoneyCents(m[0]);
          if (val !== null) {
            const already = allAssertions.some(
              (a) => a.fieldPath === "property.windHailDeductibleCents" && a.pageNumber === page.pageNumber
            );
            if (!already) {
              allAssertions.push(
                await makeAssertion({
                  documentId: document.documentId,
                  pageNumber: page.pageNumber,
                  entityScope: "coverage",
                  fieldPath: "property.windHailDeductibleCents",
                  rawText: m[0],
                  parsedValue: val,
                  normalizedValue: val,
                  confidence: 0.85,
                  authority
                })
              );
            }
          }
        }
      }
    }
    if (authority !== "coverage_summary" && authority !== "insurance_certificate") {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const next = lines[i + 1]?.trim() ?? "";
        const kind = extractNoticeKind(line, next);
        if (kind) {
          allNotices.push({
            kind,
            text: line,
            pageNumber: page.pageNumber,
            authority
          });
        }
      }
    }
  }
  const { selected, conflicts } = resolveByAuthority(allAssertions);
  const insuredLocationAssertions = selectedValues(selected).filter(
    (a) => a.addressRole === "insured_location"
  );
  const postalCode = selected["property.postalCode"]?.normalizedValue;
  const city = selected["property.city"]?.normalizedValue;
  const province = selected["property.province"]?.normalizedValue;
  const streetAddress = selected["property.streetAddress"]?.normalizedValue;
  const occupancy = selected["property.occupancy"]?.normalizedValue ?? "unknown";
  const policyNumber = selected["policy.policyNumber"]?.normalizedValue;
  const hasInsuredStreet = selectedValues(selected).some(
    (a) => a.fieldPath === "property.streetAddress" && a.addressRole === "insured_location"
  );
  const addressRedacted = !hasInsuredStreet || insuredLocationAssertions.some(
    (a) => a.fieldPath === "property.streetAddress" && isRedactedStreet(a.normalizedValue)
  );
  const policyRedacted = !policyNumber || policyNumber === "0000";
  const displayLabel = `${city ?? ""} ${province ?? ""} ${postalCode ?? ""}`.trim();
  const identityFingerprint = normalizeAddress(
    `${streetAddress ?? ""} ${city ?? ""} ${province ?? ""} ${postalCode ?? ""}`.trim()
  ) || normalizeAddress(
    `${occupancy} ${city ?? ""} ${province ?? ""} ${postalCode ?? ""} ${policyNumber ?? ""}`.trim()
  );
  let matchClassification = "new";
  if (policyRedacted || occupancy === "principal_residence" && addressRedacted) {
    matchClassification = "new_identity_confirmation_required";
  }
  const assetAssertions = [
    {
      assetType: "property",
      identityFingerprint,
      displayLabel,
      matchClassification,
      occupancy,
      assertions: selectedValues(selected)
    }
  ];
  const buildPolicyTerms = (s) => [
    {
      effectiveDate: s["policy.effectiveDate"]?.normalizedValue,
      expiryDate: s["policy.expiryDate"]?.normalizedValue,
      policyNumber: s["policy.policyNumber"]?.normalizedValue,
      annualPremiumCents: s["policy.annualPremiumCents"]?.normalizedValue
    }
  ];
  const selectedMap = {};
  for (const [path, a] of Object.entries(selected)) {
    selectedMap[path] = a.id;
  }
  const result2 = {
    classification: "home_policy_renewal",
    insurer: { name: "Security National Insurance Company" },
    agency: { name: "TD Insurance Direct Agency Inc." },
    policyTerms: buildPolicyTerms(selected),
    assertions: allAssertions,
    selectedAssertions: selectedMap,
    conflicts,
    notices: allNotices,
    assetAssertions,
    coverageAssertions: selectedValues(selected),
    parserId: ID,
    parserVersion: VERSION,
    pageCount: document.pageCount
  };
  return result2;
}

// src/parsers/td-auto.ts
var ID2 = "TdSecurityNationalAlbertaAutoRenewalParserV1";
var VERSION2 = "1.0.0";
var KNOWN_MAKES = /* @__PURE__ */ new Set([
  "MAZDA",
  "HONDA",
  "TOYOTA",
  "FORD",
  "CHEVROLET",
  "CHEVY",
  "BMW",
  "MERCEDES",
  "AUDI",
  "HYUNDAI",
  "KIA",
  "NISSAN",
  "VOLKSWAGEN",
  "VW",
  "JEEP",
  "DODGE",
  "CHRYSLER",
  "SUBARU",
  "LEXUS",
  "ACURA",
  "INFINITI",
  "LINCOLN",
  "GMC",
  "BUICK",
  "CADILLAC",
  "VOLVO",
  "LAND ROVER",
  "PORSCHE",
  "MINI",
  "SMART",
  "FIAT",
  "MITSUBISHI"
]);
var BODY_STYLE_TOKENS = /* @__PURE__ */ new Set([
  "2DR",
  "3DR",
  "4DR",
  "5DR",
  "2D",
  "4D",
  "HATCHBACK",
  "SEDAN",
  "WAGON",
  "SUV",
  "TRUCK",
  "VAN",
  "CAB",
  "PICKUP",
  "COUPE",
  "CONVERTIBLE"
]);
function canParseAuto(document) {
  const text = document.pages.map((p) => p.text).join("\n").toLowerCase();
  return text.includes("security national insurance company") && text.includes("auto insurance") && text.includes("certificate of automobile insurance");
}
function detectPageAuthority2(text) {
  const t = text.toLowerCase();
  if (t.includes("certificate of automobile insurance")) return "insurance_certificate";
  if (t.includes("coverage summary page")) return "coverage_summary";
  if (t.includes("motor vehicle liability insurance card")) return "insurance_certificate";
  if (t.includes("invoice")) return "invoice";
  if (t.includes("overview of your") && t.includes("auto")) return "renewal_overview";
  if (t.includes("important information") || t.includes("notice")) return "notice";
  return "header_footer";
}
function nextNonEmpty2(lines, start, max = 5) {
  for (let i = 1; i <= max && start + i < lines.length; i++) {
    const v = lines[start + i].trim();
    if (v.length > 0) return v;
  }
  return null;
}
function findAmountNear(lines, start, maxDistance = 6) {
  for (let i = 1; i <= maxDistance && start + i < lines.length; i++) {
    const line = lines[start + i].trim();
    const m = line.match(/\$([\d,]+(?:\.\d{2})?)/);
    if (m) {
      const val = parseMoneyCents(m[0]);
      if (val !== null) return val;
    }
  }
  return null;
}
function findVehicleUse(lines, start) {
  for (let i = 1; i <= 12 && start + i < lines.length; i++) {
    const t = lines[start + i].trim();
    if (t.length === 0) continue;
    if (/^(Pleasure|Business|Commute|Farm|To\/From Work|All Purpose)$/i.test(t)) {
      return t;
    }
  }
  return null;
}
function parseTermRange2(text) {
  const m = text.match(/(\d{4}-\d{2}-\d{2})\s*(?:to|-|–)\s*(\d{4}-\d{2}-\d{2})/);
  if (m) return { effective: m[1], expiry: m[2] };
  const m2 = text.match(/([A-Za-z]+\s+\d{1,2},?\s+\d{4})\s*[-–]\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/);
  if (m2) {
    return {
      effective: parseDateIso(m2[1]) ?? void 0,
      expiry: parseDateIso(m2[2]) ?? void 0
    };
  }
  return {};
}
function isPolicyNumberCandidate2(value) {
  const cleaned = value.replace(/\s/g, "");
  if (cleaned.length === 0) return false;
  if (!/^\d+$/.test(cleaned)) return false;
  if (cleaned.length < 5) return false;
  return true;
}
function findPolicyNumber2(lines, start) {
  for (let i = 1; i <= 8 && start + i < lines.length; i++) {
    const v = lines[start + i].trim();
    if (v.length === 0) continue;
    if (isPolicyNumberCandidate2(v)) return v.replace(/\s/g, "");
  }
  return null;
}
function splitModelString(input, knownMake) {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { model: input };
  let firstToken = tokens[0];
  let rest = tokens.slice(1);
  if (knownMake) {
    const makeUpper = knownMake.toUpperCase();
    const firstUpper = firstToken.toUpperCase();
    if (firstUpper === makeUpper && rest.length > 0) {
      firstToken = rest[0];
      rest = rest.slice(1);
    }
  }
  const bodyStyles = [];
  while (rest.length > 0 && BODY_STYLE_TOKENS.has(rest[rest.length - 1].toUpperCase())) {
    bodyStyles.unshift(rest.pop());
  }
  return {
    model: firstToken,
    trim: rest.length > 0 ? rest.join(" ") : void 0,
    bodyStyle: bodyStyles.length > 0 ? bodyStyles.join(" ") : void 0
  };
}
function extractVehicleIdentity(lines) {
  const fullText = lines.join("\n");
  const dashMatch = fullText.match(
    /(\d{4})\s*[-–]\s*([A-Z][A-Z0-9]*)\s*[-–]\s*(.+?)\s*[-–]\s*([A-HJ-NPR-Z0-9]{17})/i
  );
  if (dashMatch) {
    const year = Number.parseInt(dashMatch[1], 10);
    const make = dashMatch[2].trim().toUpperCase();
    const modelString = dashMatch[3].trim();
    const vin = dashMatch[4].trim().toUpperCase();
    const normalized = normalizeVin(vin);
    if (normalized) {
      const { model, trim, bodyStyle } = splitModelString(modelString, make);
      return { year, make, model, trim, bodyStyle, vin: normalized.normalized };
    }
  }
  const spaceMatch = fullText.match(/(\d{4})\s+([A-Z][A-Z0-9]*)\s+(.+?)\s+([A-HJ-NPR-Z0-9]{17})/i);
  if (spaceMatch) {
    const year = Number.parseInt(spaceMatch[1], 10);
    const make = spaceMatch[2].trim().toUpperCase();
    const modelString = spaceMatch[3].trim();
    const vin = spaceMatch[4].trim().toUpperCase();
    const normalized = normalizeVin(vin);
    if (normalized) {
      const { model, trim, bodyStyle } = splitModelString(modelString, make);
      return { year, make, model, trim, bodyStyle, vin: normalized.normalized };
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const vinMatch = line.match(/^([A-HJ-NPR-Z0-9]{17})$/);
    if (!vinMatch) continue;
    const vin = vinMatch[1].toUpperCase();
    const normalized = normalizeVin(vin);
    if (!normalized) continue;
    const candidates = [];
    if (i > 0) candidates.push(lines[i - 1].trim());
    if (i > 1) candidates.push(lines[i - 2].trim());
    if (i + 1 < lines.length) candidates.push(lines[i + 1].trim());
    let modelString;
    let make;
    let year;
    for (const c of candidates) {
      if (/^[A-Z][A-Z0-9\s]*(?:DR|SEDAN|HATCH|WAGON)?$/i.test(c) && c.length > 2) {
        modelString = c;
      }
      const yearMatch = c.match(/\b(\d{4})\b/);
      if (yearMatch) year = Number.parseInt(yearMatch[1], 10);
    }
    if (!modelString) continue;
    const firstToken = modelString.split(/\s+/)[0].toUpperCase();
    for (const known of KNOWN_MAKES) {
      if (firstToken.startsWith(known) && firstToken.length > known.length) {
        make = known;
        break;
      } else if (firstToken === known) {
        make = known;
        break;
      }
    }
    const { model, trim, bodyStyle } = splitModelString(modelString, make);
    return { year, make, model, trim, bodyStyle, vin: normalized.normalized };
  }
  return null;
}
function coverageStatusFromText(text) {
  const lower = text.toLowerCase();
  if (lower.includes("not covered") || lower.includes("not included")) return "not_included";
  if (lower.includes("not applicable")) return "not_applicable";
  if (lower.includes("included")) return "included";
  return "unknown";
}
function parsePhysicalDamageStatuses(lines) {
  const text = lines.join("\n");
  if (!/All Perils/i.test(text) && !/Collision or Upset/i.test(text)) return null;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/Limits and Amounts in Dollars|Amount Deductible/i.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  const tokens = [];
  for (let i = start; i < lines.length && !/Premium in Dollars|Vehicle Premium|Endorsements/i.test(lines[i]); i++) {
    const t = lines[i].trim();
    if (t.length > 0) tokens.push(t);
  }
  const rowStart = tokens.findIndex((t) => /^1$/.test(t));
  if (rowStart < 0 || rowStart + 6 >= tokens.length) return null;
  const statusTexts = tokens.slice(rowStart + 3, rowStart + 7);
  return {
    allPerils: coverageStatusFromText(statusTexts[0] ?? ""),
    collision: coverageStatusFromText(statusTexts[1] ?? ""),
    comprehensive: coverageStatusFromText(statusTexts[2] ?? ""),
    specifiedPerils: coverageStatusFromText(statusTexts[3] ?? "")
  };
}
function extractNoticeKind2(line, next) {
  const text = `${line} ${next}`.toLowerCase();
  if (text.includes("will change in the future") || text.includes("will now appear") || text.includes("will be eligible")) {
    return "future_coverage_change";
  }
  if (text.includes("available to purchase") || text.includes("contact us to add") || text.includes("consider this coverage") || text.includes("to purchase this coverage")) {
    return "coverage_available_for_purchase";
  }
  if (text.includes("may be eligible")) return "eligibility_notice";
  if (text.includes("please contact us") || text.includes("call us") || text.includes("reach out to")) {
    return "customer_action_required";
  }
  if (text.includes("if you do nothing") && text.includes("policy will renew"))
    return "renewal_information";
  if (text.includes("general description") || text.includes("this is not a complete description")) {
    return "general_explanation";
  }
  return null;
}
async function parseAuto(document) {
  const allAssertions = [];
  const allNotices = [];
  const occurrenceIndex = /* @__PURE__ */ new Map();
  async function makeAssertion(fields) {
    const key = fields.fieldPath;
    const idx = occurrenceIndex.get(key) ?? 0;
    occurrenceIndex.set(key, idx + 1);
    const id = await assertionId({
      fileDigest: document.fileDigest,
      parserId: ID2,
      parserVersion: VERSION2,
      pageNumber: fields.pageNumber,
      fieldPath: fields.fieldPath,
      occurrenceIndex: idx,
      normalizedValue: fields.normalizedValue
    });
    return { id, parserId: ID2, parserVersion: VERSION2, ...fields };
  }
  for (const page of document.pages) {
    const lines = splitLines(page.text);
    const authority = detectPageAuthority2(page.text);
    const identity = extractVehicleIdentity(lines);
    if (identity?.vin) {
      const { year: year2, make: make2, model: model2, trim: trim2, bodyStyle: bodyStyle2, vin: vin2 } = identity;
      if (year2) {
        allAssertions.push(
          await makeAssertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "vehicle",
            fieldPath: "vehicle.year",
            rawText: String(year2),
            parsedValue: year2,
            normalizedValue: year2,
            confidence: 0.99,
            authority: "insurance_certificate"
          })
        );
      }
      if (make2) {
        allAssertions.push(
          await makeAssertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "vehicle",
            fieldPath: "vehicle.make",
            rawText: make2,
            parsedValue: make2,
            normalizedValue: make2.toUpperCase(),
            confidence: 0.99,
            authority: "insurance_certificate"
          })
        );
      }
      if (model2) {
        allAssertions.push(
          await makeAssertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "vehicle",
            fieldPath: "vehicle.model",
            rawText: model2,
            parsedValue: model2,
            normalizedValue: model2.toUpperCase(),
            confidence: 0.99,
            authority: "insurance_certificate"
          })
        );
      }
      if (trim2) {
        allAssertions.push(
          await makeAssertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "vehicle",
            fieldPath: "vehicle.trim",
            rawText: trim2,
            parsedValue: trim2,
            normalizedValue: trim2.toUpperCase(),
            confidence: 0.95,
            authority: "insurance_certificate"
          })
        );
      }
      if (bodyStyle2) {
        allAssertions.push(
          await makeAssertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "vehicle",
            fieldPath: "vehicle.bodyStyle",
            rawText: bodyStyle2,
            parsedValue: bodyStyle2,
            normalizedValue: bodyStyle2.toUpperCase(),
            confidence: 0.95,
            authority: "insurance_certificate"
          })
        );
      }
      allAssertions.push(
        await makeAssertion({
          documentId: document.documentId,
          pageNumber: page.pageNumber,
          entityScope: "vehicle",
          fieldPath: "vehicle.vin",
          rawText: vin2,
          parsedValue: vin2,
          normalizedValue: vin2,
          confidence: 0.99,
          authority: "insurance_certificate"
        })
      );
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lower = line.toLowerCase();
      if (lower.includes("renewal term")) {
        const next = nextNonEmpty2(lines, i);
        const after = nextNonEmpty2(lines, i + 1);
        const range = parseTermRange2(`${next ?? ""} ${after ?? ""}`);
        if (range.effective) {
          allAssertions.push(
            await makeAssertion({
              documentId: document.documentId,
              pageNumber: page.pageNumber,
              entityScope: "policy",
              fieldPath: "policy.effectiveDate",
              rawText: `${next ?? ""} ${after ?? ""}`,
              parsedValue: range.effective,
              normalizedValue: range.effective,
              confidence: 0.9,
              authority
            })
          );
        }
        if (range.expiry) {
          allAssertions.push(
            await makeAssertion({
              documentId: document.documentId,
              pageNumber: page.pageNumber,
              entityScope: "policy",
              fieldPath: "policy.expiryDate",
              rawText: `${next ?? ""} ${after ?? ""}`,
              parsedValue: range.expiry,
              normalizedValue: range.expiry,
              confidence: 0.9,
              authority
            })
          );
        }
      }
      if (lower.startsWith("policy number") || lower.startsWith("policy no")) {
        const val = findPolicyNumber2(lines, i);
        if (val) {
          allAssertions.push(
            await makeAssertion({
              documentId: document.documentId,
              pageNumber: page.pageNumber,
              entityScope: "policy",
              fieldPath: "policy.policyNumber",
              rawText: val,
              parsedValue: val,
              normalizedValue: val,
              confidence: 0.9,
              authority
            })
          );
        }
      }
      if (lower.startsWith("effective date")) {
        const val = nextNonEmpty2(lines, i);
        if (val && /^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
          allAssertions.push(
            await makeAssertion({
              documentId: document.documentId,
              pageNumber: page.pageNumber,
              entityScope: "policy",
              fieldPath: "policy.effectiveDate",
              rawText: val,
              parsedValue: val.trim(),
              normalizedValue: val.trim(),
              confidence: 0.95,
              authority: "insurance_certificate"
            })
          );
        }
      }
      if (lower.startsWith("expiry date")) {
        const val = nextNonEmpty2(lines, i);
        if (val && /^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
          allAssertions.push(
            await makeAssertion({
              documentId: document.documentId,
              pageNumber: page.pageNumber,
              entityScope: "policy",
              fieldPath: "policy.expiryDate",
              rawText: val,
              parsedValue: val.trim(),
              normalizedValue: val.trim(),
              confidence: 0.95,
              authority: "insurance_certificate"
            })
          );
        }
      }
      if (lower.includes("total policy term insurance premium") || lower.includes("policy term insurance premium")) {
        const m = line.match(/\$([\d,]+(?:\.\d{2})?)/);
        if (m) {
          const cents = parseMoneyCents(m[0]);
          if (cents !== null) {
            allAssertions.push(
              await makeAssertion({
                documentId: document.documentId,
                pageNumber: page.pageNumber,
                entityScope: "premium",
                fieldPath: "policy.annualPremiumCents",
                rawText: m[0],
                parsedValue: cents,
                normalizedValue: cents,
                confidence: 0.9,
                authority
              })
            );
          }
        }
      }
      if (lower.includes("use of") && (lower.includes("vehicle") || lines[i + 1]?.toLowerCase().includes("vehicle"))) {
        const use = findVehicleUse(lines, i);
        if (use) {
          allAssertions.push(
            await makeAssertion({
              documentId: document.documentId,
              pageNumber: page.pageNumber,
              entityScope: "vehicle",
              fieldPath: "vehicle.vehicleUse",
              rawText: use,
              parsedValue: use,
              normalizedValue: use.toUpperCase(),
              confidence: 0.85,
              authority
            })
          );
        }
      }
      if (lower.includes("third party liability") || lower.includes("liability") && line.includes("$")) {
        const m = line.match(/\$([\d,]+(?:\.\d{2})?)/);
        if (m) {
          const cents = parseMoneyCents(m[0]);
          if (cents !== null && cents > 5e6) {
            allAssertions.push(
              await makeAssertion({
                documentId: document.documentId,
                pageNumber: page.pageNumber,
                entityScope: "coverage",
                fieldPath: "vehicle.thirdPartyLiabilityLimitCents",
                rawText: m[0],
                parsedValue: cents,
                normalizedValue: cents,
                confidence: 0.95,
                authority,
                coveragePresence: "included"
              })
            );
          }
        }
      }
      if (lower.includes("direct compensation")) {
        const val = findAmountNear(lines, i);
        if (val !== null) {
          allAssertions.push(
            await makeAssertion({
              documentId: document.documentId,
              pageNumber: page.pageNumber,
              entityScope: "coverage",
              fieldPath: "vehicle.directCompensationDeductibleCents",
              rawText: String(val),
              parsedValue: val,
              normalizedValue: val,
              confidence: 0.9,
              authority
            })
          );
        }
      }
      if (lower.includes("family protection")) {
        const searchText = lines.slice(i, i + 4).join(" ");
        const m = searchText.match(/\$([\d,]+(?:\.\d{2})?)/);
        const included = lower.includes("included") || m && parseMoneyCents(m[0]) !== null && parseMoneyCents(m[0]) > 0;
        if (included) {
          const premiumCents = m ? parseMoneyCents(m[0]) : null;
          allAssertions.push(
            await makeAssertion({
              documentId: document.documentId,
              pageNumber: page.pageNumber,
              entityScope: "coverage",
              fieldPath: "vehicle.familyProtectionIncluded",
              rawText: m ? m[0] : "included",
              parsedValue: premiumCents ?? "included",
              normalizedValue: premiumCents ?? "included",
              confidence: 0.9,
              authority,
              coveragePresence: "included"
            })
          );
        }
      }
    }
    const physical = parsePhysicalDamageStatuses(lines);
    if (physical) {
      const map = [
        ["allPerils", "vehicle.allPerilsIncluded"],
        ["collision", "vehicle.collisionIncluded"],
        ["comprehensive", "vehicle.comprehensiveIncluded"],
        ["specifiedPerils", "vehicle.specifiedPerilsIncluded"]
      ];
      for (const [key, fieldPath] of map) {
        const presence = physical[key];
        allAssertions.push(
          await makeAssertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "coverage",
            fieldPath,
            rawText: presence,
            parsedValue: presence,
            normalizedValue: presence,
            confidence: 0.9,
            authority,
            coveragePresence: presence
          })
        );
      }
    }
    const coverageKeywords = [
      { label: "all perils", fieldPath: "vehicle.allPerilsIncluded" },
      { label: "collision or upset", fieldPath: "vehicle.collisionIncluded" },
      { label: "comprehensive", fieldPath: "vehicle.comprehensiveIncluded" },
      { label: "specified perils", fieldPath: "vehicle.specifiedPerilsIncluded" }
    ];
    for (let i = 0; i < lines.length; i++) {
      const lower = lines[i].toLowerCase();
      for (const { label, fieldPath } of coverageKeywords) {
        if (lower.includes(label)) {
          const nextText = lines.slice(i, i + 4).join(" ");
          const presence = coverageStatusFromText(nextText);
          const already = allAssertions.some(
            (a) => a.fieldPath === fieldPath && a.pageNumber === page.pageNumber
          );
          if (!already) {
            allAssertions.push(
              await makeAssertion({
                documentId: document.documentId,
                pageNumber: page.pageNumber,
                entityScope: "coverage",
                fieldPath,
                rawText: nextText,
                parsedValue: presence,
                normalizedValue: presence,
                confidence: 0.85,
                authority,
                coveragePresence: presence
              })
            );
          }
        }
      }
    }
    if (authority !== "insurance_certificate" && authority !== "coverage_summary") {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const next = lines[i + 1]?.trim() ?? "";
        const kind = extractNoticeKind2(line, next);
        if (kind) {
          allNotices.push({
            kind,
            text: line,
            pageNumber: page.pageNumber,
            authority
          });
        }
      }
    }
  }
  const { selected, conflicts } = resolveByAuthority(allAssertions);
  const vin = selected["vehicle.vin"]?.normalizedValue;
  const year = selected["vehicle.year"]?.normalizedValue;
  const make = selected["vehicle.make"]?.normalizedValue;
  const model = selected["vehicle.model"]?.normalizedValue;
  const trim = selected["vehicle.trim"]?.normalizedValue;
  const bodyStyle = selected["vehicle.bodyStyle"]?.normalizedValue;
  const identityFingerprint = vin ? vin.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
  const displayLabel = [year ? String(year) : void 0, make, model, trim, bodyStyle].filter(Boolean).join(" ") || identityFingerprint.slice(-4);
  const assetAssertions = [
    {
      assetType: "vehicle",
      identityFingerprint,
      displayLabel,
      matchClassification: vin ? "new" : "new_identity_confirmation_required",
      occupancy: void 0,
      assertions: selectedValues(selected)
    }
  ];
  const buildPolicyTerms = (s) => [
    {
      effectiveDate: s["policy.effectiveDate"]?.normalizedValue,
      expiryDate: s["policy.expiryDate"]?.normalizedValue,
      policyNumber: s["policy.policyNumber"]?.normalizedValue,
      annualPremiumCents: s["policy.annualPremiumCents"]?.normalizedValue
    }
  ];
  const selectedMap = {};
  for (const [path, a] of Object.entries(selected)) {
    selectedMap[path] = a.id;
  }
  const result2 = {
    classification: "auto_policy_renewal",
    insurer: { name: "Security National Insurance Company" },
    agency: { name: "TD Insurance Direct Agency Inc." },
    policyTerms: buildPolicyTerms(selected),
    assertions: allAssertions,
    selectedAssertions: selectedMap,
    conflicts,
    notices: allNotices,
    assetAssertions,
    coverageAssertions: selectedValues(selected),
    parserId: ID2,
    parserVersion: VERSION2,
    pageCount: document.pageCount
  };
  return result2;
}

// src/parsers/index.ts
var parsers = [
  {
    id: "TdSecurityNationalHomeRenewalParserV1",
    version: "1.0.0",
    canParse: canParseHome,
    parse: parseHome
  },
  {
    id: "TdSecurityNationalAlbertaAutoRenewalParserV1",
    version: "1.0.0",
    canParse: canParseAuto,
    parse: parseAuto
  }
];
async function parseDocument(document) {
  for (const parser of parsers) {
    if (parser.canParse(document)) {
      const parsed = await parser.parse(document);
      return ParsedInsuranceDocument.parse({
        ...parsed,
        documentId: document.documentId,
        fileDigest: document.fileDigest,
        pageCount: document.pageCount
      });
    }
  }
  return ParsedInsuranceDocument.parse({
    classification: "unsupported",
    documentId: document.documentId,
    fileDigest: document.fileDigest,
    pageCount: document.pageCount,
    parserId: "none",
    parserVersion: "0"
  });
}

// src/entity-identity.ts
var STREET_SUFFIXES = {
  AVENUE: "AVE",
  BOULEVARD: "BLVD",
  CIRCLE: "CIR",
  COURT: "CT",
  CRESCENT: "CRES",
  DRIVE: "DR",
  GARDENS: "GDNS",
  GATE: "GT",
  HEIGHTS: "HTS",
  HIGHWAY: "HWY",
  LANE: "LN",
  PLACE: "PL",
  ROAD: "RD",
  STREET: "ST",
  TERRACE: "TER",
  TRAIL: "TRL"
};
var DIRECTIONALS = {
  NORTH: "N",
  NORTHEAST: "NE",
  NORTHWEST: "NW",
  SOUTH: "S",
  SOUTHEAST: "SE",
  SOUTHWEST: "SW",
  EAST: "E",
  WEST: "W"
};
var REDACTION_MARKERS = [
  "REDACTED",
  "WITHHELD",
  "NOT PROVIDED",
  "UNKNOWN",
  "XXXX",
  "****",
  "\u2022\u2022\u2022\u2022"
];
function normalizeTokenText(input) {
  return input.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[#.,'’/\\()-]/g, " ").replace(/\s+/g, " ").trim();
}
function normalizeAddressTokens(input) {
  return normalizeTokenText(input).split(" ").filter(Boolean).map((token) => DIRECTIONALS[token] ?? STREET_SUFFIXES[token] ?? token).join(" ");
}
function isRedactedOrPlaceholder(input) {
  if (!input) return true;
  const normalized = normalizeTokenText(input);
  if (!normalized) return true;
  return REDACTION_MARKERS.some((marker) => normalized.includes(marker));
}
function normalizeUnit(input) {
  if (!input || isRedactedOrPlaceholder(input)) return null;
  const normalized = normalizeTokenText(input).replace(/^(UNIT|SUITE|APT|APARTMENT)\s+/, "");
  return normalized || null;
}
function normalizeOptionalText(input) {
  if (!input || isRedactedOrPlaceholder(input)) return null;
  const normalized = normalizeTokenText(input);
  return normalized || null;
}
function joinFingerprintParts(parts) {
  return parts.map((part) => part ?? "").join("|");
}
function buildPropertyIdentity(input) {
  const reasons = [];
  const normalizedAddressLine1 = input.addressLine1 && !isRedactedOrPlaceholder(input.addressLine1) ? normalizeAddressTokens(input.addressLine1) : null;
  const hasStreetNumber = normalizedAddressLine1 && normalizedAddressLine1.split(/\s+/).some((token) => /^\d+$/.test(token));
  const normalizedUnit = normalizeUnit(input.unit);
  const normalizedCity = normalizeOptionalText(input.city);
  const normalizedProvince = input.province ? normalizeProvince(input.province) ?? null : null;
  const normalizedPostalCode = input.postalCode ? normalizePostalCode(input.postalCode) ?? null : null;
  if (input.isRedacted || !normalizedAddressLine1 || !hasStreetNumber) {
    reasons.push("insured_civic_address_missing_or_redacted");
  }
  if (!normalizedCity) reasons.push("insured_city_missing");
  if (!normalizedProvince) reasons.push("insured_province_missing_or_invalid");
  if (!normalizedPostalCode) reasons.push("insured_postal_code_missing_or_invalid");
  const completeAddress = normalizedAddressLine1 && hasStreetNumber && normalizedCity && normalizedProvince && normalizedPostalCode;
  const exactFingerprint = completeAddress ? `property:${joinFingerprintParts([
    normalizedUnit,
    normalizedAddressLine1,
    normalizedCity,
    normalizedProvince,
    normalizedPostalCode.replace(/\s/g, "")
  ])}` : null;
  const occupancy = input.occupancy ?? "unknown";
  const possibleMatchHint = normalizedPostalCode ? `property-hint:${normalizedPostalCode.replace(/\s/g, "")}:${occupancy}` : null;
  if (exactFingerprint) {
    return {
      strength: "exact",
      exactFingerprint,
      possibleMatchHint,
      requiresCustomerConfirmation: false,
      normalizedAddressLine1,
      normalizedUnit,
      normalizedCity,
      normalizedProvince,
      normalizedPostalCode,
      reasons
    };
  }
  return {
    strength: possibleMatchHint ? "confirmation_required" : "possible",
    exactFingerprint: null,
    possibleMatchHint,
    requiresCustomerConfirmation: true,
    normalizedAddressLine1,
    normalizedUnit,
    normalizedCity,
    normalizedProvince,
    normalizedPostalCode,
    reasons
  };
}
function buildVehicleIdentity(input) {
  const reasons = [];
  const vin = input.vin ? normalizeVin(input.vin) : null;
  if (vin) {
    return {
      strength: "exact",
      exactFingerprint: `vehicle:vin:${vin.normalized}`,
      possibleMatchHint: null,
      requiresCustomerConfirmation: false,
      normalizedVin: vin.normalized,
      maskedVin: vin.display,
      reasons
    };
  }
  reasons.push(input.vin ? "vin_invalid" : "vin_missing");
  const make = normalizeOptionalText(input.make);
  const model = normalizeOptionalText(input.model);
  const trim = normalizeOptionalText(input.trim);
  const modelYear = input.modelYear && Number.isInteger(input.modelYear) ? input.modelYear : null;
  const possibleMatchHint = modelYear && make && model ? `vehicle-hint:${joinFingerprintParts([modelYear.toString(), make, model, trim])}` : null;
  if (!modelYear) reasons.push("model_year_missing_or_invalid");
  if (!make) reasons.push("make_missing");
  if (!model) reasons.push("model_missing");
  return {
    strength: possibleMatchHint ? "possible" : "confirmation_required",
    exactFingerprint: null,
    possibleMatchHint,
    requiresCustomerConfirmation: true,
    normalizedVin: null,
    maskedVin: null,
    reasons
  };
}
function canAutoMergeIdentity(left, right) {
  return Boolean(
    left.exactFingerprint && right.exactFingerprint && left.exactFingerprint === right.exactFingerprint
  );
}

// src/document-intake-planner.ts
var ACTIVE_SESSION_STATUSES = /* @__PURE__ */ new Set(["collecting", "reviewing"]);
function normalizeDigest(value) {
  return value.trim().toLowerCase();
}
function normalizeId(value) {
  return value.trim();
}
function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function compareIncoming(left, right) {
  const digestDifference = normalizeDigest(left.fileDigest).localeCompare(
    normalizeDigest(right.fileDigest)
  );
  if (digestDifference !== 0) return digestDifference;
  return normalizeId(left.uploadId).localeCompare(normalizeId(right.uploadId));
}
function planDocumentIntake(input) {
  const existingDocuments = input.existingDocuments ?? [];
  const existingSessions = input.existingSessions ?? [];
  const blockers = [];
  const seenUploadIds = /* @__PURE__ */ new Set();
  for (const document of input.incoming) {
    const uploadId = normalizeId(document.uploadId);
    const fileDigest = normalizeDigest(document.fileDigest);
    if (!uploadId) {
      blockers.push({
        code: "missing_upload_id",
        message: "Every incoming document requires a non-empty upload ID."
      });
    } else if (seenUploadIds.has(uploadId)) {
      blockers.push({
        code: "duplicate_upload_id",
        uploadId,
        message: "Upload IDs must be unique within one intake request."
      });
    }
    seenUploadIds.add(uploadId);
    if (!fileDigest) {
      blockers.push({
        code: "missing_file_digest",
        uploadId: uploadId || void 0,
        message: "Every incoming document requires a non-empty file digest."
      });
    }
  }
  const activeSessions = existingSessions.filter((session2) => ACTIVE_SESSION_STATUSES.has(session2.status)).sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  if (activeSessions.length > 1) {
    blockers.push({
      code: "multiple_active_review_sessions",
      message: "A household may have only one collecting or reviewing policy-import session."
    });
  }
  const existingByDigest = /* @__PURE__ */ new Map();
  for (const document of existingDocuments) {
    const documentId = normalizeId(document.documentId);
    const fileDigest = normalizeDigest(document.fileDigest);
    if (!documentId || !fileDigest) {
      blockers.push({
        code: "invalid_existing_document",
        fileDigest: fileDigest || void 0,
        message: "Existing household documents require non-empty document IDs and file digests."
      });
      continue;
    }
    const matches = existingByDigest.get(fileDigest) ?? [];
    matches.push({
      ...document,
      documentId,
      fileDigest
    });
    existingByDigest.set(fileDigest, matches);
  }
  for (const [fileDigest, documents] of existingByDigest) {
    const uniqueDocumentIds = new Set(documents.map((document) => document.documentId));
    if (uniqueDocumentIds.size > 1) {
      blockers.push({
        code: "existing_digest_collision",
        fileDigest,
        message: "Multiple stored household documents share one digest; reconcile them before intake."
      });
    }
  }
  if (blockers.length > 0) {
    return {
      ready: false,
      session: { mode: "none" },
      acceptedUploads: [],
      duplicateUploads: [],
      blockers
    };
  }
  const sortedIncoming = [...input.incoming].map((document) => ({
    ...document,
    uploadId: normalizeId(document.uploadId),
    fileDigest: normalizeDigest(document.fileDigest)
  })).sort(compareIncoming);
  const incomingByDigest = /* @__PURE__ */ new Map();
  for (const document of sortedIncoming) {
    const matches = incomingByDigest.get(document.fileDigest) ?? [];
    matches.push(document);
    incomingByDigest.set(document.fileDigest, matches);
  }
  const acceptedDrafts = [];
  const duplicateUploads = [];
  for (const [fileDigest, documents] of [...incomingByDigest.entries()].sort(
    ([left], [right]) => left.localeCompare(right)
  )) {
    const existing = existingByDigest.get(fileDigest)?.[0];
    if (existing) {
      const linkedActiveSession = activeSessions.find(
        (session2) => session2.documentIds.includes(existing.documentId)
      );
      const fallbackSessionId = [...existing.reviewSessionIds ?? []].sort()[0];
      for (const document of documents) {
        duplicateUploads.push({
          uploadId: document.uploadId,
          fileDigest,
          reason: "already_exists_in_household",
          existingDocumentId: existing.documentId,
          existingReviewSessionId: linkedActiveSession?.sessionId ?? fallbackSessionId
        });
      }
      continue;
    }
    const [canonical, ...duplicates] = documents;
    acceptedDrafts.push({
      uploadId: canonical.uploadId,
      fileDigest
    });
    for (const duplicate of duplicates) {
      duplicateUploads.push({
        uploadId: duplicate.uploadId,
        fileDigest,
        reason: "duplicate_in_batch",
        canonicalUploadId: canonical.uploadId
      });
    }
  }
  if (acceptedDrafts.length === 0) {
    return {
      ready: true,
      session: { mode: "none" },
      acceptedUploads: [],
      duplicateUploads,
      blockers: []
    };
  }
  const session = activeSessions.length === 1 ? { mode: "reuse", sessionId: activeSessions[0].sessionId } : {
    mode: "create",
    provisionalKey: `policy-intake:${stableHash(
      acceptedDrafts.map((document) => document.fileDigest).join("|")
    )}`
  };
  return {
    ready: true,
    session,
    acceptedUploads: acceptedDrafts.map((document) => ({
      ...document,
      session
    })),
    duplicateUploads,
    blockers: []
  };
}

// src/incremental-onboarding-session.ts
function clean(value) {
  return value.trim();
}
function keyPart(value) {
  return encodeURIComponent(clean(value)).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase());
}
function candidateIdFor(documentFingerprint, localCandidateId) {
  return `candidate:${keyPart(documentFingerprint)}:${keyPart(localCandidateId)}`;
}
function duplicateGroupIdFor(identityFingerprint) {
  return `duplicate:${keyPart(identityFingerprint)}`;
}
function hasValue(value) {
  return value !== void 0 && value !== null;
}
function defaultMandatedValue(specification) {
  return hasValue(specification.defaultMandatedValue) ? specification.defaultMandatedValue : specification.currentValue;
}
function sortedSpecifications(specifications) {
  return [...specifications].sort(
    (left, right) => clean(left.fieldPath).localeCompare(clean(right.fieldPath))
  );
}
function documentSnapshotFingerprint(upload) {
  return [...upload.candidates].sort(
    (left, right) => clean(left.localCandidateId).localeCompare(clean(right.localCandidateId))
  ).map((candidate) => {
    const specifications = sortedSpecifications(candidate.specifications).map(
      (specification) => `${keyPart(specification.fieldPath)}=${keyPart(specification.extractionFingerprint)}`
    ).join(",");
    return [
      keyPart(candidate.localCandidateId),
      candidate.assetType,
      keyPart(candidate.identityFingerprint),
      keyPart(candidate.reviewFingerprint),
      specifications
    ].join("|");
  }).join("||");
}
function validateUpload(upload) {
  const blockers = [];
  if (!clean(upload.uploadId)) {
    blockers.push({
      code: "missing_upload_id",
      message: "Incremental uploads require a non-empty upload ID."
    });
  }
  if (!clean(upload.documentFingerprint)) {
    blockers.push({
      code: "missing_document_fingerprint",
      message: "Incremental uploads require a document content fingerprint."
    });
  }
  if (!clean(upload.extractionRevision)) {
    blockers.push({
      code: "missing_extraction_revision",
      message: "Incremental uploads require an extraction revision."
    });
  }
  const seenCandidates = /* @__PURE__ */ new Set();
  for (const candidate of upload.candidates) {
    const localCandidateId = clean(candidate.localCandidateId);
    if (!localCandidateId) {
      blockers.push({
        code: "missing_local_candidate_id",
        localCandidateId,
        message: "Every extracted asset requires a stable document-local ID."
      });
    } else if (seenCandidates.has(localCandidateId)) {
      blockers.push({
        code: "duplicate_local_candidate_id",
        localCandidateId,
        message: "Document-local candidate IDs must be unique."
      });
    }
    seenCandidates.add(localCandidateId);
    if (!clean(candidate.reviewFingerprint)) {
      blockers.push({
        code: "missing_candidate_review_fingerprint",
        localCandidateId,
        message: "Every candidate requires a semantic review fingerprint."
      });
    }
    const seenFields = /* @__PURE__ */ new Set();
    for (const specification of candidate.specifications) {
      const fieldPath = clean(specification.fieldPath);
      if (!fieldPath) {
        blockers.push({
          code: "missing_specification_field_path",
          localCandidateId,
          fieldPath,
          message: "Every specification requires a field path."
        });
      } else if (seenFields.has(fieldPath)) {
        blockers.push({
          code: "duplicate_specification_field_path",
          localCandidateId,
          fieldPath,
          message: "A candidate may contain each specification only once."
        });
      }
      seenFields.add(fieldPath);
      if (!clean(specification.extractionFingerprint)) {
        blockers.push({
          code: "missing_specification_extraction_fingerprint",
          localCandidateId,
          fieldPath,
          message: "Every specification requires an extraction fingerprint."
        });
      }
    }
  }
  return blockers;
}
function cloneSession(session) {
  return {
    ...session,
    documents: session.documents.map((document) => ({
      ...document,
      candidateIds: [...document.candidateIds]
    })),
    candidates: session.candidates.map((candidate) => ({
      ...candidate,
      specifications: candidate.specifications.map((specification) => ({
        ...specification
      }))
    }))
  };
}
function createCandidate(documentFingerprint, candidate) {
  return {
    candidateId: candidateIdFor(documentFingerprint, candidate.localCandidateId),
    sourceDocumentFingerprint: clean(documentFingerprint),
    localCandidateId: clean(candidate.localCandidateId),
    assetType: candidate.assetType,
    identityFingerprint: clean(candidate.identityFingerprint),
    reviewFingerprint: clean(candidate.reviewFingerprint),
    decision: "pending",
    existingEntityId: void 0,
    reviewFreshness: "unreviewed",
    specifications: sortedSpecifications(candidate.specifications).map((specification) => ({
      fieldPath: clean(specification.fieldPath),
      extractionFingerprint: clean(specification.extractionFingerprint),
      currentValue: specification.currentValue,
      mandatedValue: defaultMandatedValue(specification),
      mandatedValueOrigin: "defaulted_from_current",
      confirmed: false,
      superseded: false
    })),
    duplicateGroupId: void 0,
    superseded: false,
    revision: 1
  };
}
function reconcileSpecifications(previous, incoming, forceUnconfirmed) {
  const previousByField = new Map(
    previous.specifications.map((specification) => [clean(specification.fieldPath), specification])
  );
  const incomingFields = /* @__PURE__ */ new Set();
  const specifications = [];
  let changed = false;
  for (const incomingSpecification of sortedSpecifications(incoming.specifications)) {
    const fieldPath = clean(incomingSpecification.fieldPath);
    incomingFields.add(fieldPath);
    const existing = previousByField.get(fieldPath);
    if (!existing) {
      changed = true;
      specifications.push({
        fieldPath,
        extractionFingerprint: clean(incomingSpecification.extractionFingerprint),
        currentValue: incomingSpecification.currentValue,
        mandatedValue: defaultMandatedValue(incomingSpecification),
        mandatedValueOrigin: "defaulted_from_current",
        confirmed: false,
        superseded: false
      });
      continue;
    }
    const specificationChanged = existing.extractionFingerprint !== clean(incomingSpecification.extractionFingerprint) || existing.superseded;
    if (specificationChanged) changed = true;
    specifications.push({
      fieldPath,
      extractionFingerprint: clean(incomingSpecification.extractionFingerprint),
      currentValue: incomingSpecification.currentValue,
      mandatedValue: existing.mandatedValueOrigin === "customer_customized" ? existing.mandatedValue : defaultMandatedValue(incomingSpecification),
      mandatedValueOrigin: existing.mandatedValueOrigin,
      confirmed: forceUnconfirmed || specificationChanged ? false : existing.confirmed,
      superseded: false
    });
  }
  for (const existing of previous.specifications) {
    if (incomingFields.has(clean(existing.fieldPath))) continue;
    changed = true;
    specifications.push({ ...existing, confirmed: false, superseded: true });
  }
  specifications.sort((left, right) => left.fieldPath.localeCompare(right.fieldPath));
  return { specifications, changed };
}
function duplicateGroupsFor(candidates) {
  const byFingerprint = /* @__PURE__ */ new Map();
  for (const candidate of candidates) {
    const fingerprint = clean(candidate.identityFingerprint);
    if (candidate.superseded || !fingerprint) continue;
    const candidateIds = byFingerprint.get(fingerprint) ?? [];
    candidateIds.push(candidate.candidateId);
    byFingerprint.set(fingerprint, candidateIds);
  }
  return [...byFingerprint.entries()].filter(([, candidateIds]) => candidateIds.length > 1).sort(([left], [right]) => left.localeCompare(right)).map(([identityFingerprint, candidateIds]) => ({
    duplicateGroupId: duplicateGroupIdFor(identityFingerprint),
    identityFingerprint,
    candidateIds: [...candidateIds].sort((left, right) => left.localeCompare(right))
  }));
}
function assignDuplicateGroups(candidates) {
  const duplicateGroups = duplicateGroupsFor(candidates);
  const groupByCandidate = /* @__PURE__ */ new Map();
  for (const group of duplicateGroups) {
    for (const candidateId of group.candidateIds) {
      groupByCandidate.set(candidateId, group.duplicateGroupId);
    }
  }
  return {
    candidates: candidates.map((candidate) => ({
      ...candidate,
      duplicateGroupId: groupByCandidate.get(candidate.candidateId)
    })),
    duplicateGroups
  };
}
function warningsFor(duplicateGroups, staleCandidateIds, supersededCandidateIds) {
  const warnings = [];
  if (duplicateGroups.length > 0) warnings.push("potential_duplicate_assets_present");
  if (staleCandidateIds.length > 0) warnings.push("customer_review_became_stale");
  if (supersededCandidateIds.length > 0) {
    warnings.push("candidates_removed_by_reprocessing");
  }
  return warnings;
}
function result(outcome, session, duplicateGroups, values = {}) {
  return {
    accepted: outcome !== "blocked",
    outcome,
    session,
    blockers: values.blockers ?? [],
    addedCandidateIds: values.addedCandidateIds ?? [],
    updatedCandidateIds: values.updatedCandidateIds ?? [],
    staleCandidateIds: values.staleCandidateIds ?? [],
    supersededCandidateIds: values.supersededCandidateIds ?? [],
    duplicateGroups,
    warnings: values.warnings ?? []
  };
}
function createEmptyIncrementalOnboardingSession() {
  return { version: 1, revision: 0, documents: [], candidates: [] };
}
function mergeIncrementalOnboardingUpload(session, upload) {
  const blockers = validateUpload(upload);
  const currentGroups = duplicateGroupsFor(session.candidates);
  if (blockers.length > 0) {
    return result("blocked", session, currentGroups, { blockers });
  }
  const documentFingerprint = clean(upload.documentFingerprint);
  const extractionRevision = clean(upload.extractionRevision);
  const snapshotFingerprint = documentSnapshotFingerprint(upload);
  const existingDocument = session.documents.find(
    (document) => document.documentFingerprint === documentFingerprint
  );
  if (existingDocument?.snapshotFingerprint === snapshotFingerprint && existingDocument.extractionRevision === extractionRevision) {
    return result("duplicate_document", session, currentGroups, {
      warnings: warningsFor(currentGroups, [], [])
    });
  }
  const next = cloneSession(session);
  const addedCandidateIds = [];
  const updatedCandidateIds = [];
  const staleCandidateIds = [];
  const supersededCandidateIds = [];
  if (!existingDocument) {
    const candidateIds = upload.candidates.map((incoming) => {
      const candidate = createCandidate(documentFingerprint, incoming);
      next.candidates.push(candidate);
      addedCandidateIds.push(candidate.candidateId);
      return candidate.candidateId;
    });
    next.documents.push({
      documentFingerprint,
      latestUploadId: clean(upload.uploadId),
      extractionRevision,
      snapshotFingerprint,
      candidateIds
    });
    next.revision += 1;
    const grouped2 = assignDuplicateGroups(next.candidates);
    next.candidates = grouped2.candidates;
    return result("document_added", next, grouped2.duplicateGroups, {
      addedCandidateIds,
      warnings: warningsFor(grouped2.duplicateGroups, [], [])
    });
  }
  const documentIndex = next.documents.findIndex(
    (document) => document.documentFingerprint === documentFingerprint
  );
  if (existingDocument.snapshotFingerprint === snapshotFingerprint) {
    next.documents[documentIndex] = {
      ...next.documents[documentIndex],
      latestUploadId: clean(upload.uploadId),
      extractionRevision
    };
    next.revision += 1;
    const grouped2 = assignDuplicateGroups(next.candidates);
    next.candidates = grouped2.candidates;
    return result("document_reprocessed_unchanged", next, grouped2.duplicateGroups, {
      warnings: warningsFor(grouped2.duplicateGroups, [], [])
    });
  }
  const incomingIds = new Set(
    upload.candidates.map(
      (candidate) => candidateIdFor(documentFingerprint, candidate.localCandidateId)
    )
  );
  for (let index = 0; index < next.candidates.length; index += 1) {
    const candidate = next.candidates[index];
    if (candidate.sourceDocumentFingerprint !== documentFingerprint || incomingIds.has(candidate.candidateId)) {
      continue;
    }
    next.candidates[index] = {
      ...candidate,
      reviewFreshness: "stale",
      specifications: candidate.specifications.map((specification) => ({
        ...specification,
        confirmed: false,
        superseded: true
      })),
      duplicateGroupId: void 0,
      superseded: true,
      revision: candidate.revision + 1
    };
    staleCandidateIds.push(candidate.candidateId);
    supersededCandidateIds.push(candidate.candidateId);
  }
  const activeCandidateIds = [];
  for (const incoming of upload.candidates) {
    const candidateId = candidateIdFor(documentFingerprint, incoming.localCandidateId);
    activeCandidateIds.push(candidateId);
    const index = next.candidates.findIndex((candidate) => candidate.candidateId === candidateId);
    if (index < 0) {
      next.candidates.push(createCandidate(documentFingerprint, incoming));
      addedCandidateIds.push(candidateId);
      continue;
    }
    const previous = next.candidates[index];
    const identityChanged = previous.assetType !== incoming.assetType || clean(previous.identityFingerprint) !== clean(incoming.identityFingerprint);
    const reviewFingerprintChanged = previous.reviewFingerprint !== clean(incoming.reviewFingerprint);
    const reconciled = reconcileSpecifications(
      previous,
      incoming,
      identityChanged || reviewFingerprintChanged
    );
    const candidateChanged = identityChanged || reviewFingerprintChanged || previous.superseded || reconciled.changed;
    if (!candidateChanged) continue;
    next.candidates[index] = {
      ...previous,
      assetType: incoming.assetType,
      identityFingerprint: clean(incoming.identityFingerprint),
      reviewFingerprint: clean(incoming.reviewFingerprint),
      decision: identityChanged ? "pending" : previous.decision,
      existingEntityId: identityChanged ? void 0 : previous.existingEntityId,
      reviewFreshness: "stale",
      specifications: reconciled.specifications,
      superseded: false,
      revision: previous.revision + 1
    };
    updatedCandidateIds.push(candidateId);
    staleCandidateIds.push(candidateId);
  }
  next.documents[documentIndex] = {
    documentFingerprint,
    latestUploadId: clean(upload.uploadId),
    extractionRevision,
    snapshotFingerprint,
    candidateIds: activeCandidateIds
  };
  next.revision += 1;
  const grouped = assignDuplicateGroups(next.candidates);
  next.candidates = grouped.candidates;
  return result("document_reprocessed_changed", next, grouped.duplicateGroups, {
    addedCandidateIds,
    updatedCandidateIds,
    staleCandidateIds,
    supersededCandidateIds,
    warnings: warningsFor(grouped.duplicateGroups, staleCandidateIds, supersededCandidateIds)
  });
}

// src/mandate-reconciliation.ts
var MANDATE_FIELD_DEFINITIONS = {
  "vehicle.thirdPartyLiabilityLimitCents": {
    assetType: "vehicle",
    title: "Liability limit",
    mandatePath: "liability",
    kind: "limit"
  },
  "vehicle.collisionDeductibleCents": {
    assetType: "vehicle",
    title: "Collision deductible",
    mandatePath: "collisionDeductible",
    kind: "deductible"
  },
  "vehicle.comprehensiveDeductibleCents": {
    assetType: "vehicle",
    title: "Comprehensive deductible",
    mandatePath: "comprehensiveDeductible",
    kind: "deductible"
  },
  "vehicle.glassDeductibleCents": {
    assetType: "vehicle",
    title: "Glass deductible",
    mandatePath: "glassDeductible",
    kind: "deductible"
  },
  "vehicle.collisionIncluded": {
    assetType: "vehicle",
    title: "Auto coverage form",
    mandatePath: "coverageForm",
    kind: "coverage_form",
    coverageFormValue: "collision"
  },
  "vehicle.comprehensiveIncluded": {
    assetType: "vehicle",
    title: "Auto coverage form",
    mandatePath: "coverageForm",
    kind: "coverage_form",
    coverageFormValue: "comprehensive"
  },
  "vehicle.specifiedPerilsIncluded": {
    assetType: "vehicle",
    title: "Auto coverage form",
    mandatePath: "coverageForm",
    kind: "coverage_form",
    coverageFormValue: "specified_perils"
  },
  "vehicle.allPerilsIncluded": {
    assetType: "vehicle",
    title: "Auto coverage form",
    mandatePath: "coverageForm",
    kind: "coverage_form",
    coverageFormValue: "all_perils"
  },
  "vehicle.familyProtectionIncluded": {
    assetType: "vehicle",
    title: "Family protection",
    mandatePath: "endorsements.family_protection",
    kind: "preference"
  },
  "property.dwellingLimitCents": {
    assetType: "property",
    title: "Dwelling limit",
    mandatePath: "dwellingLimit",
    kind: "limit"
  },
  "property.contentsLimitCents": {
    assetType: "property",
    title: "Contents limit",
    mandatePath: "contentsLimit",
    kind: "limit"
  },
  "property.personalLiabilityLimitCents": {
    assetType: "property",
    title: "Personal liability limit",
    mandatePath: "personalLiabilityLimit",
    kind: "limit"
  },
  "property.fairRentalValueLimitCents": {
    assetType: "property",
    title: "Additional living or fair rental value limit",
    mandatePath: "additionalLivingExpenseLimit",
    kind: "limit"
  },
  "property.baseDeductibleCents": {
    assetType: "property",
    title: "Base deductible",
    mandatePath: "baseDeductible",
    kind: "deductible"
  },
  "property.waterDeductibleCents": {
    assetType: "property",
    title: "Water deductible",
    mandatePath: "waterDeductible",
    kind: "deductible"
  },
  "property.windHailDeductibleCents": {
    assetType: "property",
    title: "Wind and hail deductible",
    mandatePath: "windHailDeductible",
    kind: "deductible"
  },
  "property.earthquakeDeductibleCents": {
    assetType: "property",
    title: "Earthquake deductible",
    mandatePath: "earthquakeDeductible",
    kind: "deductible"
  }
};
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeDocumentValueState(status) {
  switch (status) {
    case "known":
      return "known";
    case "not_included":
    case "explicitly_absent":
    case "absent":
      return "absent";
    case "not_applicable":
      return "not_applicable";
    case "conflicting":
      return "conflicting";
    default:
      return "unknown";
  }
}
function deriveMandateValue(definition, state, documentValue, suggestion) {
  if (state === "conflicting" || state === "unknown") return null;
  if (state === "not_applicable") {
    if (definition.kind === "preference") return "indifferent";
    if (definition.kind === "coverage_form") {
      return { preference: "indifferent", value: definition.coverageFormValue ?? "unknown" };
    }
    return { rule: "any" };
  }
  if (state === "absent") {
    if (definition.kind === "preference") return "prohibited";
    if (definition.kind === "coverage_form") {
      return { preference: "required", value: "liability_only" };
    }
    return { rule: "any" };
  }
  if (isRecord(suggestion) && typeof suggestion.rule === "string") {
    return suggestion;
  }
  if (definition.kind === "limit" && Number.isInteger(documentValue)) {
    return { rule: "minimum", amountCents: documentValue };
  }
  if (definition.kind === "deductible" && Number.isInteger(documentValue)) {
    return { rule: "maximum", amountCents: documentValue };
  }
  if (definition.kind === "preference" && typeof documentValue === "boolean") {
    return documentValue ? "required" : "prohibited";
  }
  if (definition.kind === "coverage_form" && typeof documentValue === "boolean") {
    return documentValue ? { preference: "required", value: definition.coverageFormValue ?? "unknown" } : { preference: "required", value: "liability_only" };
  }
  if (definition.kind === "coverage_form" && typeof documentValue === "string") {
    return { preference: "required", value: documentValue };
  }
  return null;
}
function seedPriority(seed) {
  const statePriority = {
    conflicting: 500,
    known: 400,
    absent: 300,
    not_applicable: 200
  }[seed.valueState];
  const formValue = isRecord(seed.documentImpliedMandateValue) ? seed.documentImpliedMandateValue.value : void 0;
  const formPriority = typeof formValue === "string" ? {
    liability_only: 1,
    specified_perils: 2,
    collision: 3,
    comprehensive: 4,
    all_perils: 5
  }[formValue] ?? 0 : 0;
  return statePriority + formPriority;
}
function extractConflictValues(definition, currentValue, conflicts) {
  const sharedExplanation = conflicts.find(isRecord)?.explanation;
  if (Array.isArray(currentValue.alternatives)) {
    return currentValue.alternatives.filter(isRecord).map((alternative) => {
      const evidence = Array.isArray(alternative.evidence) ? alternative.evidence.find(isRecord) : void 0;
      const documentValue = alternative.normalizedValue ?? alternative.value;
      return {
        documentValue,
        mandateValue: deriveMandateValue(definition, "known", documentValue, void 0),
        sourceDocumentId: evidence && typeof evidence.documentId === "string" ? evidence.documentId : void 0,
        sourcePageNumber: evidence && Number.isInteger(evidence.pageNumber) ? evidence.pageNumber : void 0,
        sourceSection: evidence && typeof evidence.section === "string" ? evidence.section : void 0,
        explanation: typeof alternative.explanation === "string" ? alternative.explanation : typeof sharedExplanation === "string" ? sharedExplanation : void 0
      };
    });
  }
  return conflicts.filter(isRecord).map((conflict) => ({
    explanation: conflict.explanation,
    assertionIds: conflict.assertionIds
  }));
}
function buildMandateReviewSeeds(candidates) {
  const seeds = /* @__PURE__ */ new Map();
  for (const candidate of candidates) {
    const facts = candidate.selected_facts_json;
    const currentCoverage = isRecord(facts.currentCoverage) ? facts.currentCoverage : {};
    const suggestions = isRecord(facts.mandateSuggestions) ? facts.mandateSuggestions : {};
    const conflicts = Array.isArray(candidate.conflicts_json) ? candidate.conflicts_json : [];
    for (const fieldPath of Object.keys(currentCoverage).sort()) {
      const definition = MANDATE_FIELD_DEFINITIONS[fieldPath];
      if (!definition || definition.assetType !== candidate.asset_type) continue;
      const extracted = currentCoverage[fieldPath];
      if (!isRecord(extracted)) continue;
      const state = normalizeDocumentValueState(extracted.status);
      if (state === "unknown") continue;
      const relevantConflicts = conflicts.filter(
        (conflict) => isRecord(conflict) && conflict.fieldPath === fieldPath
      );
      const alternatives = extractConflictValues(definition, extracted, relevantConflicts);
      const firstAlternative = alternatives.find(isRecord);
      const evidence = Array.isArray(extracted.evidence) ? extracted.evidence.find(isRecord) : void 0;
      const documentValue = extracted.value;
      const seed = {
        candidateId: candidate.id,
        fieldPath: `currentCoverage.${fieldPath}`,
        specificationTitle: definition.title,
        mandatePath: definition.mandatePath,
        valueState: state,
        originalExtractedValue: extracted,
        documentImpliedValue: documentValue,
        documentImpliedMandateValue: deriveMandateValue(
          definition,
          state,
          documentValue,
          suggestions[fieldPath]
        ),
        sourceDocumentId: evidence && typeof evidence.documentId === "string" ? evidence.documentId : firstAlternative && typeof firstAlternative.sourceDocumentId === "string" ? firstAlternative.sourceDocumentId : void 0,
        sourcePageNumber: evidence && Number.isInteger(evidence.pageNumber) ? evidence.pageNumber : firstAlternative && Number.isInteger(firstAlternative.sourcePageNumber) ? firstAlternative.sourcePageNumber : void 0,
        sourceSection: evidence && typeof evidence.section === "string" ? evidence.section : firstAlternative && typeof firstAlternative.sourceSection === "string" ? firstAlternative.sourceSection : void 0,
        confidence: typeof extracted.confidence === "number" ? extracted.confidence : void 0,
        conflictValues: alternatives,
        materialConflict: state === "conflicting" && relevantConflicts.some(
          (conflict) => isRecord(conflict) && conflict.requiresHumanResolution === true
        )
      };
      const specificationKey = `${seed.candidateId}:${seed.mandatePath}`;
      const existing = seeds.get(specificationKey);
      if (!existing || seedPriority(seed) > seedPriority(existing)) {
        seeds.set(specificationKey, seed);
      }
    }
  }
  return Array.from(seeds.values()).sort(
    (left, right) => `${left.candidateId}:${left.mandatePath}`.localeCompare(
      `${right.candidateId}:${right.mandatePath}`
    )
  );
}
function setNestedValue(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index++) {
    const part = parts[index];
    const next = cursor[part];
    if (!isRecord(next)) cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}
function buildCandidateMandateValues(reviews) {
  const result2 = /* @__PURE__ */ new Map();
  for (const review of reviews) {
    if (!review.isComplete) {
      throw new Error("Every document-informed mandate specification must be completed");
    }
    if (review.materialConflict && review.action === "unresolved") {
      throw new Error("Material mandate conflicts must be resolved before approval");
    }
    if (!review.mandatePath || review.currentMandateValue === void 0) continue;
    const candidateValues = result2.get(review.candidateId) ?? {};
    setNestedValue(candidateValues, review.mandatePath, review.currentMandateValue);
    result2.set(review.candidateId, candidateValues);
  }
  return result2;
}

// src/dangerous-mode-policy.ts
var DANGEROUS_MODE_DISCLOSURE_VERSION = "dangerous-mode-v1";
function validateDangerousModeEnablePolicy(input) {
  if (!input.explicitConfirmation || !input.foreignProcessingAcknowledged || !input.automatedProcessingAcknowledged || !input.rawProcessingApproved) {
    return "ACKNOWLEDGEMENTS_REQUIRED";
  }
  if (input.disclosureVersion !== DANGEROUS_MODE_DISCLOSURE_VERSION) {
    return "DISCLOSURE_VERSION_MISMATCH";
  }
  return null;
}
function documentProcessingRoute(mode) {
  return mode === "dangerous" ? { dispatchExternalProcessing: true, route: "automatic_processing" } : { dispatchExternalProcessing: false, route: "manual_review" };
}

// src/document-batch.ts
function partitionDocumentDigests(documentIds, digestByDocumentId, previouslyProcessedDigests) {
  const duplicateDocumentIds = [];
  const newDocumentIds = [];
  for (const documentId of documentIds) {
    const digest = digestByDocumentId[documentId];
    if (!digest) throw new Error(`Missing digest for document ${documentId}`);
    if (previouslyProcessedDigests.has(digest)) duplicateDocumentIds.push(documentId);
    else newDocumentIds.push(documentId);
  }
  return { duplicateDocumentIds, newDocumentIds };
}

// src/llm-contract.ts
var LLM_EXTRACTION_SCHEMA_VERSION = 1;
var LLM_EXTRACTION_PROMPT_VERSION = "insurance-document-v1";
var JsonValueSchema = z.lazy(
  () => z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema)
  ])
);
var LlmFactStatusSchema = z.enum([
  "known",
  "unknown",
  "not_applicable",
  "conflicting",
  "requires_confirmation"
]);
var LlmTemporalApplicabilitySchema = z.enum([
  "current_term",
  "future_term",
  "historical",
  "general_information",
  "unknown"
]);
var LlmCoverageActivitySchema = z.enum([
  "active",
  "explicitly_absent",
  "offered_not_active",
  "future_change",
  "general_description",
  "unknown"
]);
var LlmSourceAuthoritySchema = z.enum([
  "coverage_summary",
  "insurance_certificate",
  "active_endorsement",
  "invoice",
  "renewal_overview",
  "informational_notice",
  "policy_wording",
  "header_footer",
  "unknown"
]);
var LlmEvidenceSchema = z.object({
  documentId: z.string().min(1),
  pageNumber: z.number().int().positive(),
  evidenceText: z.string().trim().min(1).max(1500),
  authority: LlmSourceAuthoritySchema,
  boundingBox: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative()
  }).strict().optional()
}).strict();
var LlmAlternativeValueSchema = z.object({
  value: JsonValueSchema,
  normalizedValue: JsonValueSchema.optional(),
  evidence: z.array(LlmEvidenceSchema).min(1)
}).strict();
var LocalIdSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9._:-]+$/, "Use a stable local identifier without whitespace");
var LlmAssertionSchema = z.object({
  id: LocalIdSchema,
  entityRef: LocalIdSchema,
  fieldPath: z.string().min(1).max(240).regex(/^[A-Za-z][A-Za-z0-9_.[\]-]*$/, "Use a dotted field path"),
  factKind: z.enum(["identity", "policy", "coverage", "premium", "notice", "underwriting"]),
  status: LlmFactStatusSchema,
  value: JsonValueSchema.optional(),
  normalizedValue: JsonValueSchema.optional(),
  confidence: z.number().min(0).max(1),
  temporalApplicability: LlmTemporalApplicabilitySchema,
  coverageActivity: LlmCoverageActivitySchema.optional(),
  evidence: z.array(LlmEvidenceSchema),
  alternatives: z.array(LlmAlternativeValueSchema).optional(),
  explanation: z.string().trim().min(1).max(1e3).optional()
}).strict().superRefine((assertion, ctx) => {
  const hasValue2 = assertion.value !== void 0 || assertion.normalizedValue !== void 0;
  if ((assertion.status === "known" || assertion.status === "requires_confirmation") && !hasValue2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["value"],
      message: `${assertion.status} assertions require a value`
    });
  }
  if ((assertion.status === "known" || assertion.status === "not_applicable" || assertion.status === "requires_confirmation") && assertion.evidence.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["evidence"],
      message: `${assertion.status} assertions require page evidence`
    });
  }
  if (assertion.status === "unknown" && hasValue2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["value"],
      message: "unknown assertions must not contain a guessed value"
    });
  }
  if (assertion.status === "conflicting" && (assertion.alternatives?.length ?? 0) < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["alternatives"],
      message: "conflicting assertions require at least two evidenced alternatives"
    });
  }
});
var LlmAssetCandidateBase = {
  localId: LocalIdSchema,
  displayLabel: z.string().trim().min(1).max(240),
  identityAssertionIds: z.array(LocalIdSchema).min(1),
  proposedMatchClassification: z.enum([
    "new",
    "possible_existing_match",
    "exact_existing_match_proposed",
    "identity_confirmation_required"
  ]),
  autoMergeAllowed: z.literal(false).default(false),
  rationale: z.string().trim().min(1).max(1e3)
};
var LlmPropertyCandidateSchema = z.object({
  ...LlmAssetCandidateBase,
  assetType: z.literal("property"),
  occupancy: z.enum(["principal_residence", "rental", "seasonal", "vacant", "unknown"]),
  insuredLocationStatus: z.enum(["complete", "partial", "redacted", "unknown"])
}).strict();
var LlmVehicleCandidateSchema = z.object({
  ...LlmAssetCandidateBase,
  assetType: z.literal("vehicle"),
  vinStatus: z.enum(["valid_appearing", "partial", "redacted", "missing", "invalid_appearing"])
}).strict();
var LlmAssetCandidateSchema = z.discriminatedUnion("assetType", [
  LlmPropertyCandidateSchema,
  LlmVehicleCandidateSchema
]);
var LlmPolicyTermSchema = z.object({
  localId: LocalIdSchema,
  policyNumberAssertionId: LocalIdSchema.optional(),
  insurerAssertionId: LocalIdSchema.optional(),
  effectiveDateAssertionId: LocalIdSchema.optional(),
  expiryDateAssertionId: LocalIdSchema.optional(),
  premiumAssertionId: LocalIdSchema.optional(),
  insuredAssetRefs: z.array(LocalIdSchema).min(1)
}).strict();
var LlmConflictSchema = z.object({
  fieldPath: z.string().min(1),
  entityRef: LocalIdSchema,
  assertionIds: z.array(LocalIdSchema).min(2),
  explanation: z.string().trim().min(1).max(1e3),
  requiresHumanResolution: z.boolean()
}).strict();
var LlmModelIdentitySchema = z.object({
  provider: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(160),
  modelVersion: z.string().trim().min(1).max(160).optional(),
  promptVersion: z.literal(LLM_EXTRACTION_PROMPT_VERSION)
}).strict();
var LlmExtractionResultSchema = z.object({
  schemaVersion: z.literal(LLM_EXTRACTION_SCHEMA_VERSION),
  documentId: z.string().min(1),
  pass: z.enum(["discovery", "asset_coverage"]),
  classification: z.enum([
    "home_policy",
    "auto_policy",
    "combined_policy",
    "endorsement",
    "invoice",
    "proof_of_insurance",
    "unsupported",
    "unknown"
  ]),
  model: LlmModelIdentitySchema,
  assets: z.array(LlmAssetCandidateSchema),
  policyTerms: z.array(LlmPolicyTermSchema),
  assertions: z.array(LlmAssertionSchema),
  conflicts: z.array(LlmConflictSchema),
  warnings: z.array(z.string().trim().min(1).max(1e3))
}).strict().superRefine((result2, ctx) => {
  const assertionIds = new Set(result2.assertions.map((assertion) => assertion.id));
  const assetIds = new Set(result2.assets.map((asset) => asset.localId));
  if (assertionIds.size !== result2.assertions.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["assertions"],
      message: "assertion IDs must be unique"
    });
  }
  if (assetIds.size !== result2.assets.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["assets"],
      message: "asset local IDs must be unique"
    });
  }
  for (const [assetIndex, asset] of result2.assets.entries()) {
    for (const assertionId2 of asset.identityAssertionIds) {
      if (!assertionIds.has(assertionId2)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assets", assetIndex, "identityAssertionIds"],
          message: `unknown identity assertion ID: ${assertionId2}`
        });
      }
    }
  }
  for (const [termIndex, term] of result2.policyTerms.entries()) {
    for (const assetRef of term.insuredAssetRefs) {
      if (!assetIds.has(assetRef)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["policyTerms", termIndex, "insuredAssetRefs"],
          message: `unknown insured asset reference: ${assetRef}`
        });
      }
    }
    const assertionReferences = [
      term.policyNumberAssertionId,
      term.insurerAssertionId,
      term.effectiveDateAssertionId,
      term.expiryDateAssertionId,
      term.premiumAssertionId
    ].filter((value) => value !== void 0);
    for (const assertionId2 of assertionReferences) {
      if (!assertionIds.has(assertionId2)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["policyTerms", termIndex],
          message: `unknown policy-term assertion ID: ${assertionId2}`
        });
      }
    }
  }
  for (const [conflictIndex, conflict] of result2.conflicts.entries()) {
    for (const assertionId2 of conflict.assertionIds) {
      if (!assertionIds.has(assertionId2)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["conflicts", conflictIndex, "assertionIds"],
          message: `unknown conflict assertion ID: ${assertionId2}`
        });
      }
    }
  }
});
var LlmPageInputSchema = z.object({
  pageNumber: z.number().int().positive(),
  text: z.string(),
  imageRef: z.string().min(1).optional()
}).strict();
var LlmExtractionPassSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("discovery")
  }).strict(),
  z.object({
    kind: z.literal("asset_coverage"),
    targetAssetLocalId: LocalIdSchema,
    relevantPageNumbers: z.array(z.number().int().positive()).min(1)
  }).strict()
]);
var LlmExtractionRequestSchema = z.object({
  documentId: z.string().min(1),
  fileDigest: z.string().regex(/^[a-f0-9]{64}$/i),
  pages: z.array(LlmPageInputSchema).min(1),
  pass: LlmExtractionPassSchema,
  requestedModel: z.string().min(1).optional()
}).strict();
function parseLlmExtractionResult(raw, request) {
  const parsedRequest = LlmExtractionRequestSchema.parse(request);
  const result2 = LlmExtractionResultSchema.parse(raw);
  if (result2.documentId !== parsedRequest.documentId) {
    throw new Error("LLM extraction result documentId does not match the request");
  }
  const pageNumbers = new Set(parsedRequest.pages.map((page) => page.pageNumber));
  for (const assertion of result2.assertions) {
    for (const evidence of assertion.evidence) {
      if (evidence.documentId !== parsedRequest.documentId) {
        throw new Error(`Assertion ${assertion.id} cites a different document`);
      }
      if (!pageNumbers.has(evidence.pageNumber)) {
        throw new Error(
          `Assertion ${assertion.id} cites page ${evidence.pageNumber}, which was not provided`
        );
      }
    }
  }
  const expectedPass = parsedRequest.pass.kind;
  if (result2.pass !== expectedPass) {
    throw new Error(`LLM extraction result pass ${result2.pass} does not match ${expectedPass}`);
  }
  return result2;
}
var BASE_INSTRUCTIONS = `You extract structured facts from Canadian insurance documents.

Return only one JSON object matching schemaVersion 1. Do not return markdown, prose outside JSON, or invented fields.

Non-negotiable rules:
1. Never guess a value to complete the schema. Use status "unknown" when the document does not establish a fact.
2. Every known, not-applicable, or confirmation-required fact must cite the exact document page and a short evidenceText excerpt.
3. Distinguish the insured property location from the customer's mailing or correspondence address.
4. Treat policy number as a policy-term identifier, never as conclusive property or vehicle identity.
5. Treat a complete VIN as a vehicle identity fact, but do not decide automatic merging.
6. Set autoMergeAllowed to false for every asset. The application performs deterministic matching later.
7. Distinguish active current coverage from advertisements, eligibility statements, optional offers, general policy wording, and future changes.
8. Phrases such as "eligible", "available", "to purchase", "consider", or "contact us to add" do not establish active coverage.
9. Prefer an applicable coverage summary or automobile certificate over an overview, invoice, notice, header, or footer. Preserve material conflicts instead of silently choosing one.
10. Preserve explicit absence separately from unknown and not applicable.
11. Do not infer zero from a blank cell. Do not infer false from an omitted field.
12. Preserve monetary values as exact integer cents in normalizedValue when the currency amount is clear.
13. Preserve dates as YYYY-MM-DD in normalizedValue when the date is clear.
14. Use stable local IDs that contain no whitespace and are unique inside the response.
15. Keep customer names, addresses, policy numbers, account numbers, and VINs only in factual values required by the extraction result; never repeat them in warnings or explanations.
16. A redacted or partial property address requires customer confirmation and cannot be proposed as an exact match.
17. A year/make/model combination without a valid complete VIN is only a possible vehicle match.
18. If two pages materially disagree, emit evidenced assertions for both and add a conflict requiring human resolution.
19. Evidence must come from pages supplied in the request.
20. Do not perform database writes, mandate generation, recommendation logic, or customer authorization decisions.`;
var DISCOVERY_INSTRUCTIONS = `

This is the discovery pass. Identify document classification, policy terms, insured assets, and identity facts. Determine which page ranges appear relevant to each asset. Extract only enough coverage information to distinguish assets and route a later asset-specific coverage pass. A document may contain multiple assets. Do not assume one document equals one policy or one asset.`;
var ASSET_COVERAGE_INSTRUCTIONS = `

This is the asset_coverage pass. Extract current-term coverage, limits, deductibles, premiums, endorsements, exclusions, and material underwriting facts for the specified asset using the supplied relevant pages. Preserve active-versus-offered status and all page evidence. Do not emit facts for a different asset merely because they share a policyholder or mailing address.`;
function buildInsuranceExtractionSystemPrompt(pass) {
  return `${BASE_INSTRUCTIONS}${pass === "discovery" ? DISCOVERY_INSTRUCTIONS : ASSET_COVERAGE_INSTRUCTIONS}`;
}

// src/llm-extraction-runner.ts
function allPageNumbers(document) {
  return document.pages.map((page) => page.pageNumber);
}
function defaultCoveragePages(discovery, asset, document) {
  const identityAssertionIds = new Set(asset.identityAssertionIds);
  const relevant = /* @__PURE__ */ new Set();
  for (const assertion of discovery.assertions) {
    if (assertion.entityRef !== asset.localId && !identityAssertionIds.has(assertion.id)) {
      continue;
    }
    for (const evidence of assertion.evidence) {
      relevant.add(evidence.pageNumber);
    }
  }
  for (const term of discovery.policyTerms) {
    if (!term.insuredAssetRefs.includes(asset.localId)) {
      continue;
    }
    const referencedAssertionIds = new Set(
      [
        term.policyNumberAssertionId,
        term.insurerAssertionId,
        term.effectiveDateAssertionId,
        term.expiryDateAssertionId,
        term.premiumAssertionId
      ].filter((value) => value !== void 0)
    );
    for (const assertion of discovery.assertions) {
      if (!referencedAssertionIds.has(assertion.id)) {
        continue;
      }
      for (const evidence of assertion.evidence) {
        relevant.add(evidence.pageNumber);
      }
    }
  }
  return relevant.size > 0 ? [...relevant].sort((a, b) => a - b) : allPageNumbers(document);
}
function buildRequest(document, pass, requestedModel) {
  return {
    documentId: document.documentId,
    fileDigest: document.fileDigest,
    pages: document.pages.map((page) => ({
      pageNumber: page.pageNumber,
      text: page.text
    })),
    pass,
    requestedModel
  };
}
function assertCoverageResultMatchesAsset(result2, assetLocalId) {
  if (result2.pass !== "asset_coverage") {
    throw new Error(`Expected asset_coverage result for ${assetLocalId}`);
  }
  const returnedAsset = result2.assets.find((asset) => asset.localId === assetLocalId);
  if (!returnedAsset) {
    throw new Error(`Coverage result omitted target asset ${assetLocalId}`);
  }
  const foreignAssertions = result2.assertions.filter(
    (assertion) => assertion.entityRef !== assetLocalId && assertion.factKind !== "policy" && assertion.factKind !== "premium" && assertion.factKind !== "notice"
  );
  if (foreignAssertions.length > 0) {
    throw new Error(
      `Coverage result for ${assetLocalId} contains assertions for another asset: ${foreignAssertions.map((assertion) => assertion.entityRef).join(", ")}`
    );
  }
}
async function runLlmExtraction(document, provider, options = {}) {
  if (document.pages.length === 0) {
    throw new Error("Cannot run LLM extraction for a document with no pages");
  }
  const discoveryRequest = buildRequest(document, { kind: "discovery" }, options.requestedModel);
  const discoveryPrompt = options.systemPrompt ?? buildInsuranceExtractionSystemPrompt("discovery");
  const discoveryRaw = await provider.extract(discoveryRequest, discoveryPrompt);
  const discovery = parseLlmExtractionResult(discoveryRaw, discoveryRequest);
  if (discovery.pass !== "discovery") {
    throw new Error("Expected discovery result from discovery pass");
  }
  if (discovery.classification === "unsupported" || discovery.assets.length === 0) {
    return {
      discovery,
      coverageByAssetLocalId: /* @__PURE__ */ new Map(),
      skippedAssetLocalIds: discovery.assets.map((asset) => asset.localId)
    };
  }
  const requestedLimit = options.maxCoveragePasses ?? discovery.assets.length;
  const maxCoveragePasses = Math.max(0, Math.min(requestedLimit, discovery.assets.length));
  const selectedAssets = discovery.assets.slice(0, maxCoveragePasses);
  const skippedAssetLocalIds = discovery.assets.slice(maxCoveragePasses).map((asset) => asset.localId);
  const coverageByAssetLocalId = /* @__PURE__ */ new Map();
  for (const asset of selectedAssets) {
    const selectedPageNumbers = options.selectCoveragePages?.(discovery, asset, document) ?? defaultCoveragePages(discovery, asset, document);
    const availablePageNumbers = new Set(allPageNumbers(document));
    const relevantPageNumbers = [...new Set(selectedPageNumbers)].filter((pageNumber) => availablePageNumbers.has(pageNumber)).sort((a, b) => a - b);
    if (relevantPageNumbers.length === 0) {
      throw new Error(`No valid coverage pages selected for asset ${asset.localId}`);
    }
    const coverageRequest = buildRequest(
      document,
      {
        kind: "asset_coverage",
        targetAssetLocalId: asset.localId,
        relevantPageNumbers
      },
      options.requestedModel
    );
    const coveragePrompt = options.systemPrompt ?? buildInsuranceExtractionSystemPrompt("asset_coverage");
    const coverageRaw = await provider.extract(coverageRequest, coveragePrompt);
    const coverage = parseLlmExtractionResult(coverageRaw, coverageRequest);
    assertCoverageResultMatchesAsset(coverage, asset.localId);
    coverageByAssetLocalId.set(asset.localId, coverage);
  }
  return {
    discovery,
    coverageByAssetLocalId,
    skippedAssetLocalIds
  };
}

// src/llm-semantic-validation.ts
var LLM_SEMANTIC_VALIDATION_VERSION = 1;
var LlmSemanticValidationError = class extends Error {
  issues;
  constructor(issues) {
    super(
      `LLM extraction failed semantic validation with ${issues.filter((issue) => issue.severity === "error").length} error(s)`
    );
    this.name = "LlmSemanticValidationError";
    this.issues = issues;
  }
};
function canonicalText(value) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function valuesEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => valuesEqual(value, right[index]));
  }
  if (isRecord2(left) && isRecord2(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && valuesEqual(left[key], right[key]));
  }
  return false;
}
function knownComparableValue(assertion) {
  return assertion.normalizedValue !== void 0 ? assertion.normalizedValue : assertion.value;
}
function isMoneyCentsField(fieldPath) {
  return /(?:^|\.)(?:annualPremiumCents|premiumCents|feeCents|amountCents|limitCents|deductibleCents)$/i.test(
    fieldPath
  );
}
function isDateField(fieldPath) {
  return /(?:^|\.)(?:effectiveDate|expiryDate|renewalDate|date)$/i.test(fieldPath);
}
function isVinField(fieldPath) {
  return /(?:^|\.)vin$/i.test(fieldPath);
}
function isPostalCodeField(fieldPath) {
  return /(?:^|\.)postalCode$/i.test(fieldPath);
}
function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = parseDateIso(value);
  if (parsed !== value) return false;
  const date = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
function addIssue(issues, issue) {
  issues.push({ ...issue, severity: issue.severity ?? "error" });
}
function validateEvidence(result2, request, issues) {
  const pages = new Map(request.pages.map((page) => [page.pageNumber, canonicalText(page.text)]));
  result2.assertions.forEach((assertion, assertionIndex) => {
    assertion.evidence.forEach((evidence, evidenceIndex) => {
      const pageText = pages.get(evidence.pageNumber);
      if (pageText === void 0) {
        addIssue(issues, {
          code: "EVIDENCE_PAGE_NOT_PROVIDED",
          path: ["assertions", assertionIndex, "evidence", evidenceIndex, "pageNumber"],
          assertionId: assertion.id,
          entityRef: assertion.entityRef,
          message: `Evidence cites page ${evidence.pageNumber}, which was not supplied to the model`
        });
        return;
      }
      const excerpt = canonicalText(evidence.evidenceText);
      if (excerpt.length < 3 || !pageText.includes(excerpt)) {
        addIssue(issues, {
          code: "EVIDENCE_TEXT_NOT_FOUND",
          path: ["assertions", assertionIndex, "evidence", evidenceIndex, "evidenceText"],
          assertionId: assertion.id,
          entityRef: assertion.entityRef,
          message: `Evidence excerpt for ${assertion.fieldPath} was not found on supplied page ${evidence.pageNumber}`
        });
      }
    });
  });
}
function validateFieldValues(result2, issues) {
  result2.assertions.forEach((assertion, assertionIndex) => {
    const value = knownComparableValue(assertion);
    if (assertion.status === "not_applicable" && value !== void 0 && value !== null && value !== false) {
      addIssue(issues, {
        code: "NOT_APPLICABLE_HAS_VALUE",
        path: ["assertions", assertionIndex, "normalizedValue"],
        assertionId: assertion.id,
        entityRef: assertion.entityRef,
        message: `${assertion.fieldPath} is not applicable but contains a substantive value`
      });
    }
    if (value !== void 0 && isMoneyCentsField(assertion.fieldPath)) {
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        addIssue(issues, {
          code: "INVALID_MONEY_CENTS",
          path: ["assertions", assertionIndex, "normalizedValue"],
          assertionId: assertion.id,
          entityRef: assertion.entityRef,
          message: `${assertion.fieldPath} must be a non-negative safe integer number of cents`
        });
      }
    }
    if (value !== void 0 && isDateField(assertion.fieldPath)) {
      if (typeof value !== "string" || !isValidIsoDate(value)) {
        addIssue(issues, {
          code: "INVALID_ISO_DATE",
          path: ["assertions", assertionIndex, "normalizedValue"],
          assertionId: assertion.id,
          entityRef: assertion.entityRef,
          message: `${assertion.fieldPath} must be a real ISO calendar date in YYYY-MM-DD form`
        });
      }
    }
    if (value !== void 0 && isVinField(assertion.fieldPath)) {
      if (typeof value !== "string") {
        addIssue(issues, {
          code: "INVALID_VIN",
          path: ["assertions", assertionIndex, "normalizedValue"],
          assertionId: assertion.id,
          entityRef: assertion.entityRef,
          message: `${assertion.fieldPath} is not a string VIN`
        });
      } else {
        const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
        const normalized = normalizeVin(value);
        if (!normalized || normalized.normalized !== compact) {
          addIssue(issues, {
            code: "INVALID_VIN",
            path: ["assertions", assertionIndex, "normalizedValue"],
            assertionId: assertion.id,
            entityRef: assertion.entityRef,
            message: `${assertion.fieldPath} is not a valid normalized 17-character VIN`
          });
        }
      }
    }
    if (value !== void 0 && isPostalCodeField(assertion.fieldPath)) {
      if (typeof value !== "string") {
        addIssue(issues, {
          code: "INVALID_POSTAL_CODE",
          path: ["assertions", assertionIndex, "normalizedValue"],
          assertionId: assertion.id,
          entityRef: assertion.entityRef,
          message: `${assertion.fieldPath} is not a string postal code`
        });
      } else {
        const normalized = normalizePostalCode(value);
        if (!normalized || normalized !== value.toUpperCase()) {
          addIssue(issues, {
            code: "INVALID_POSTAL_CODE",
            path: ["assertions", assertionIndex, "normalizedValue"],
            assertionId: assertion.id,
            entityRef: assertion.entityRef,
            message: `${assertion.fieldPath} must be a normalized Canadian postal code such as T3A 0G9`
          });
        }
      }
    }
    if (assertion.coverageActivity === "future_change" && assertion.temporalApplicability === "current_term") {
      addIssue(issues, {
        code: "TEMPORAL_ACTIVITY_CONTRADICTION",
        path: ["assertions", assertionIndex],
        assertionId: assertion.id,
        entityRef: assertion.entityRef,
        message: "A future coverage change cannot apply to the current term"
      });
    }
    if (assertion.coverageActivity === "active" && assertion.temporalApplicability !== "current_term") {
      addIssue(issues, {
        code: "ACTIVE_COVERAGE_WITHOUT_CURRENT_TERM",
        path: ["assertions", assertionIndex],
        assertionId: assertion.id,
        entityRef: assertion.entityRef,
        message: "Active coverage must be identified as applying to the current term"
      });
    }
  });
}
function validateIdentityReferences(result2, issues) {
  const assertions = new Map(result2.assertions.map((assertion) => [assertion.id, assertion]));
  result2.assets.forEach((asset, assetIndex) => {
    asset.identityAssertionIds.forEach((assertionId2, referenceIndex) => {
      const assertion = assertions.get(assertionId2);
      if (!assertion) return;
      if (assertion.factKind !== "identity") {
        addIssue(issues, {
          code: "IDENTITY_ASSERTION_KIND_MISMATCH",
          path: ["assets", assetIndex, "identityAssertionIds", referenceIndex],
          assertionId: assertionId2,
          entityRef: asset.localId,
          message: `Asset identity reference ${assertionId2} points to a ${assertion.factKind} assertion`
        });
      }
      if (assertion.entityRef !== asset.localId) {
        addIssue(issues, {
          code: "IDENTITY_ASSERTION_ENTITY_MISMATCH",
          path: ["assets", assetIndex, "identityAssertionIds", referenceIndex],
          assertionId: assertionId2,
          entityRef: asset.localId,
          message: `Identity assertion ${assertionId2} belongs to ${assertion.entityRef}, not ${asset.localId}`
        });
      }
    });
    if (asset.proposedMatchClassification === "exact_existing_match_proposed" && asset.identityAssertionIds.some((id) => (assertions.get(id)?.confidence ?? 0) < 0.95)) {
      addIssue(issues, {
        severity: "warning",
        code: "LOW_CONFIDENCE_EXACT_MATCH_PROPOSAL",
        path: ["assets", assetIndex, "proposedMatchClassification"],
        entityRef: asset.localId,
        message: "An exact-match proposal contains an identity assertion below 0.95 confidence"
      });
    }
  });
}
function validateDuplicateAndConflictSemantics(result2, issues) {
  const grouped = /* @__PURE__ */ new Map();
  result2.assertions.forEach((assertion, index) => {
    const key = `${assertion.entityRef}|${assertion.fieldPath}|${assertion.temporalApplicability}`;
    const group = grouped.get(key) ?? [];
    group.push({ assertion, index });
    grouped.set(key, group);
  });
  const declaredConflictAssertions = new Set(
    result2.conflicts.flatMap((conflict) => conflict.assertionIds)
  );
  for (const group of grouped.values()) {
    if (group.length < 2) continue;
    const known = group.filter(
      ({ assertion }) => ["known", "requires_confirmation"].includes(assertion.status)
    );
    if (known.length < 2) continue;
    const [firstKnown] = known;
    if (!firstKnown) continue;
    const firstValue = knownComparableValue(firstKnown.assertion);
    const allEqual = known.every(
      ({ assertion }) => valuesEqual(firstValue, knownComparableValue(assertion))
    );
    if (allEqual) {
      known.slice(1).forEach(({ assertion, index }) => {
        addIssue(issues, {
          severity: "warning",
          code: "DUPLICATE_FIELD_ASSERTION",
          path: ["assertions", index],
          assertionId: assertion.id,
          entityRef: assertion.entityRef,
          message: `Duplicate assertion for ${assertion.fieldPath} should be represented as additional evidence on one assertion`
        });
      });
      continue;
    }
    const allDeclared = known.every(
      ({ assertion }) => declaredConflictAssertions.has(assertion.id)
    );
    if (!allDeclared) {
      addIssue(issues, {
        code: "UNDECLARED_CONFLICT",
        path: ["assertions", firstKnown.index],
        assertionId: firstKnown.assertion.id,
        entityRef: firstKnown.assertion.entityRef,
        message: `Different values for ${firstKnown.assertion.fieldPath} require an explicit conflict`
      });
    }
  }
  const assertionById = new Map(result2.assertions.map((assertion) => [assertion.id, assertion]));
  result2.conflicts.forEach((conflict, conflictIndex) => {
    const referenced = conflict.assertionIds.map((id) => assertionById.get(id)).filter((assertion) => assertion !== void 0);
    if (referenced.length !== conflict.assertionIds.length) {
      addIssue(issues, {
        code: "INVALID_CONFLICT_REFERENCE",
        path: ["conflicts", conflictIndex, "assertionIds"],
        entityRef: conflict.entityRef,
        message: "Conflict references an assertion that does not exist"
      });
      return;
    }
    if (referenced.some((assertion) => assertion.fieldPath !== conflict.fieldPath)) {
      addIssue(issues, {
        code: "CONFLICT_FIELD_MISMATCH",
        path: ["conflicts", conflictIndex, "fieldPath"],
        entityRef: conflict.entityRef,
        message: "Every assertion in a conflict must use the conflict fieldPath"
      });
    }
    if (referenced.some((assertion) => assertion.entityRef !== conflict.entityRef)) {
      addIssue(issues, {
        code: "CONFLICT_ENTITY_MISMATCH",
        path: ["conflicts", conflictIndex, "entityRef"],
        entityRef: conflict.entityRef,
        message: "Every assertion in a conflict must belong to the same entity"
      });
    }
  });
}
function validatePolicyTermDates(result2, issues) {
  const assertions = new Map(result2.assertions.map((assertion) => [assertion.id, assertion]));
  result2.policyTerms.forEach((term, termIndex) => {
    const effective = term.effectiveDateAssertionId ? assertions.get(term.effectiveDateAssertionId) : void 0;
    const expiry = term.expiryDateAssertionId ? assertions.get(term.expiryDateAssertionId) : void 0;
    const effectiveValue = effective ? knownComparableValue(effective) : void 0;
    const expiryValue = expiry ? knownComparableValue(expiry) : void 0;
    if (typeof effectiveValue === "string" && typeof expiryValue === "string" && isValidIsoDate(effectiveValue) && isValidIsoDate(expiryValue) && effectiveValue >= expiryValue) {
      addIssue(issues, {
        code: "POLICY_TERM_DATE_ORDER",
        path: ["policyTerms", termIndex],
        entityRef: term.localId,
        message: `Policy effective date ${effectiveValue} must be before expiry date ${expiryValue}`
      });
    }
  });
}
function validatePassScope(result2, request, issues) {
  if (request.pass.kind !== "asset_coverage") return;
  const target = request.pass.targetAssetLocalId;
  const assetIds = new Set(result2.assets.map((asset) => asset.localId));
  if (!assetIds.has(target)) {
    addIssue(issues, {
      code: "ASSET_COVERAGE_TARGET_MISSING",
      path: ["assets"],
      entityRef: target,
      message: `Asset-coverage result does not include target asset ${target}`
    });
  }
  result2.assets.forEach((asset, index) => {
    if (asset.localId !== target) {
      addIssue(issues, {
        code: "ASSET_COVERAGE_OTHER_ASSET_INCLUDED",
        path: ["assets", index],
        entityRef: asset.localId,
        message: `Asset-coverage pass for ${target} must not emit another asset ${asset.localId}`
      });
    }
  });
  const declaredEntities = /* @__PURE__ */ new Set([
    ...result2.assets.map((asset) => asset.localId),
    ...result2.policyTerms.map((term) => term.localId)
  ]);
  result2.assertions.forEach((assertion, index) => {
    if (!declaredEntities.has(assertion.entityRef)) {
      addIssue(issues, {
        code: "UNREFERENCED_ASSERTION_ENTITY",
        path: ["assertions", index, "entityRef"],
        assertionId: assertion.id,
        entityRef: assertion.entityRef,
        message: `Assertion entityRef ${assertion.entityRef} is not declared in the extraction result`
      });
    }
  });
}
function validateLlmExtractionSemantics(raw, request) {
  const result2 = parseLlmExtractionResult(raw, request);
  const issues = [];
  validateEvidence(result2, request, issues);
  validateFieldValues(result2, issues);
  validateIdentityReferences(result2, issues);
  validateDuplicateAndConflictSemantics(result2, issues);
  validatePolicyTermDates(result2, issues);
  validatePassScope(result2, request, issues);
  return {
    validationVersion: LLM_SEMANTIC_VALIDATION_VERSION,
    valid: !issues.some((issue) => issue.severity === "error"),
    issues
  };
}
function assertLlmExtractionSemantics(raw, request) {
  const result2 = parseLlmExtractionResult(raw, request);
  const validation = validateLlmExtractionSemantics(result2, request);
  if (!validation.valid) throw new LlmSemanticValidationError(validation.issues);
  return result2;
}

// src/llm-parsed-document-projection.ts
var LLM_PARSED_DOCUMENT_PROJECTION_VERSION = 1;
var AUTHORITY_MAP = {
  coverage_summary: "coverage_summary",
  insurance_certificate: "insurance_certificate",
  active_endorsement: "endorsement",
  invoice: "invoice",
  renewal_overview: "renewal_overview",
  informational_notice: "notice",
  policy_wording: "notice",
  header_footer: "header_footer",
  unknown: "header_footer"
};
function sourceKey(scope, localAssertionId) {
  return `${scope}:${localAssertionId}`;
}
function comparableValue(assertion) {
  return assertion.normalizedValue !== void 0 ? assertion.normalizedValue : assertion.value;
}
function assertionParserId(result2) {
  return `llm:${result2.model.provider}:${result2.model.model}`;
}
function assertionParserVersion(result2) {
  return [
    `schema-${result2.schemaVersion}`,
    `prompt-${result2.model.promptVersion}`,
    `projection-${LLM_PARSED_DOCUMENT_PROJECTION_VERSION}`,
    result2.model.modelVersion ? `model-${result2.model.modelVersion}` : void 0
  ].filter((value) => value !== void 0).join(":");
}
function flattenResult(source, warnings) {
  const flattened = [];
  const parserId = assertionParserId(source.result);
  const parserVersion = assertionParserVersion(source.result);
  for (const assertion of source.result.assertions) {
    const key = sourceKey(source.scope, assertion.id);
    if (assertion.status === "conflicting") {
      for (const [alternativeIndex, alternative] of (assertion.alternatives ?? []).entries()) {
        for (const [evidenceIndex, evidence] of alternative.evidence.entries()) {
          flattened.push({
            sourceKey: key,
            sourceLocalId: assertion.id,
            entityRef: assertion.entityRef,
            factKind: assertion.factKind,
            fieldPath: assertion.fieldPath,
            parsedValue: alternative.value,
            normalizedValue: alternative.normalizedValue ?? alternative.value,
            confidence: assertion.confidence,
            evidence,
            evidenceIndex,
            alternativeIndex,
            parserId,
            parserVersion
          });
        }
      }
      continue;
    }
    if (assertion.evidence.length === 0) {
      warnings.push(`omitted_assertion_without_evidence:${key}`);
      continue;
    }
    const value = comparableValue(assertion);
    for (const [evidenceIndex, evidence] of assertion.evidence.entries()) {
      flattened.push({
        sourceKey: key,
        sourceLocalId: assertion.id,
        entityRef: assertion.entityRef,
        factKind: assertion.factKind,
        fieldPath: assertion.fieldPath,
        parsedValue: assertion.value ?? null,
        normalizedValue: value ?? null,
        confidence: assertion.confidence,
        evidence,
        evidenceIndex,
        parserId,
        parserVersion
      });
    }
  }
  return flattened;
}
async function deterministicUuid(seed) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed))
  ).slice(0, 16);
  digest[6] = digest[6] & 15 | 80;
  digest[8] = digest[8] & 63 | 128;
  const hex = [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function entityScopeFor(assertion, assetTypeByLocalId) {
  if (assertion.factKind === "policy" || assertion.factKind === "coverage" || assertion.factKind === "premium" || assertion.factKind === "notice") {
    return assertion.factKind;
  }
  return assetTypeByLocalId.get(assertion.entityRef) ?? "policy";
}
function mapProposedMatch(proposed) {
  switch (proposed) {
    case "new":
      return "new";
    case "possible_existing_match":
    case "exact_existing_match_proposed":
      return "possible_existing_match";
    case "identity_confirmation_required":
      return "new_identity_confirmation_required";
  }
}
function mapOccupancy(asset) {
  if (asset.assetType !== "property") return void 0;
  if (asset.occupancy === "principal_residence" || asset.occupancy === "rental") {
    return asset.occupancy;
  }
  return "unknown";
}
function mapClassification(discovery, warnings) {
  if (discovery.classification === "home_policy") return "home_policy_renewal";
  if (discovery.classification === "auto_policy") return "auto_policy_renewal";
  if (discovery.classification === "combined_policy") {
    const assetTypes = new Set(discovery.assets.map((asset) => asset.assetType));
    if (assetTypes.size === 1 && assetTypes.has("property")) {
      return "home_policy_renewal";
    }
    if (assetTypes.size === 1 && assetTypes.has("vehicle")) {
      return "auto_policy_renewal";
    }
    warnings.push("combined_home_auto_document_projected_as_unsupported");
  }
  return "unsupported";
}
function assertionValueById(result2, assertionId2) {
  if (!assertionId2) return void 0;
  const assertion = result2.assertions.find((candidate) => candidate.id === assertionId2);
  return assertion ? comparableValue(assertion) : void 0;
}
function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function nonNegativeCents(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : void 0;
}
function findStringAssertion(sources, patterns) {
  for (const source of sources) {
    for (const assertion of source.result.assertions) {
      if (!patterns.some((pattern) => pattern.test(assertion.fieldPath))) continue;
      const value = stringValue(comparableValue(assertion));
      if (value) return value;
    }
  }
  return void 0;
}
function stableValue(value) {
  if (value === void 0) return "undefined";
  if (value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value) ?? String(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableValue(entry)}`).join(",")}}`;
}
function collectSources(run) {
  return [
    { scope: "discovery", result: run.discovery },
    ...[...run.coverageByAssetLocalId.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([assetLocalId, result2]) => ({
      scope: `coverage:${assetLocalId}`,
      result: result2
    }))
  ];
}
async function projectLlmRunToParsedDocument(run, options = {}) {
  const warnings = [
    ...run.discovery.warnings.map((warning) => `discovery:${warning}`),
    ...[...run.coverageByAssetLocalId.entries()].flatMap(
      ([assetLocalId, result2]) => result2.warnings.map((warning) => `coverage:${assetLocalId}:${warning}`)
    ),
    ...run.skippedAssetLocalIds.map((assetLocalId) => `coverage_pass_skipped:${assetLocalId}`)
  ];
  const sources = collectSources(run);
  for (const source of sources) {
    if (source.result.documentId !== run.discovery.documentId) {
      throw new Error(`Projection received a foreign document in ${source.scope}`);
    }
  }
  const assetTypeByLocalId = new Map(
    run.discovery.assets.map((asset) => [asset.localId, asset.assetType])
  );
  const flatAssertions = sources.flatMap((source) => flattenResult(source, warnings));
  const projectedAssertions = await Promise.all(
    flatAssertions.map(async (assertion) => {
      const idSeed = [
        run.discovery.documentId,
        assertion.sourceKey,
        assertion.fieldPath,
        assertion.alternativeIndex ?? "direct",
        assertion.evidenceIndex,
        assertion.evidence.pageNumber,
        assertion.evidence.evidenceText
      ].join("|");
      return {
        id: await deterministicUuid(idSeed),
        documentId: run.discovery.documentId,
        pageNumber: assertion.evidence.pageNumber,
        entityScope: entityScopeFor(assertion, assetTypeByLocalId),
        fieldPath: assertion.fieldPath,
        rawText: assertion.evidence.evidenceText,
        parsedValue: assertion.parsedValue,
        normalizedValue: assertion.normalizedValue,
        parserId: assertion.parserId,
        parserVersion: assertion.parserVersion,
        confidence: assertion.confidence,
        authority: AUTHORITY_MAP[assertion.evidence.authority]
      };
    })
  );
  const assertionIdsBySourceKeyMutable = /* @__PURE__ */ new Map();
  flatAssertions.forEach((assertion, index) => {
    const projected = projectedAssertions[index];
    if (!projected) return;
    const ids = assertionIdsBySourceKeyMutable.get(assertion.sourceKey) ?? [];
    ids.push(projected.id);
    assertionIdsBySourceKeyMutable.set(assertion.sourceKey, ids);
  });
  const originalAssertionsByAsset = /* @__PURE__ */ new Map();
  for (const source of sources) {
    for (const assertion of source.result.assertions) {
      if (!assetTypeByLocalId.has(assertion.entityRef)) continue;
      const assertions = originalAssertionsByAsset.get(assertion.entityRef) ?? [];
      assertions.push(assertion);
      originalAssertionsByAsset.set(assertion.entityRef, assertions);
    }
  }
  const assets = [];
  for (const asset of run.discovery.assets) {
    const allAssetAssertions = originalAssertionsByAsset.get(asset.localId) ?? [];
    const identityAssertions = allAssetAssertions.filter(
      (assertion) => assertion.factKind === "identity"
    );
    const resolved = options.resolveAssetIdentity ? await options.resolveAssetIdentity({
      documentId: run.discovery.documentId,
      asset,
      identityAssertions,
      allAssetAssertions
    }) : {};
    const fingerprint = resolved.identityFingerprint?.trim() ?? "";
    if (!fingerprint) warnings.push(`identity_unresolved:${asset.localId}`);
    assets.push({
      assetType: asset.assetType,
      identityFingerprint: fingerprint,
      displayLabel: asset.displayLabel,
      matchClassification: fingerprint ? resolved.matchClassification ?? mapProposedMatch(asset.proposedMatchClassification) : "new_identity_confirmation_required",
      occupancy: mapOccupancy(asset),
      assertions: flatAssertions.map((assertion, index) => ({ assertion, projected: projectedAssertions[index] })).filter(
        (entry) => entry.projected !== void 0 && entry.assertion.entityRef === asset.localId
      ).map((entry) => entry.projected)
    });
  }
  const policyTerms = [];
  const seenPolicyTerms = /* @__PURE__ */ new Set();
  for (const source of sources) {
    for (const term of source.result.policyTerms) {
      const projectedTerm = {
        effectiveDate: stringValue(
          assertionValueById(source.result, term.effectiveDateAssertionId)
        ),
        expiryDate: stringValue(assertionValueById(source.result, term.expiryDateAssertionId)),
        policyNumber: stringValue(assertionValueById(source.result, term.policyNumberAssertionId)),
        annualPremiumCents: nonNegativeCents(
          assertionValueById(source.result, term.premiumAssertionId)
        )
      };
      const key = stableValue(projectedTerm);
      if (seenPolicyTerms.has(key)) continue;
      seenPolicyTerms.add(key);
      policyTerms.push(projectedTerm);
    }
  }
  const conflicts = [];
  const conflictKeys = /* @__PURE__ */ new Set();
  const addConflict = (fieldPath, assertionIds, reason) => {
    const uniqueIds = [...new Set(assertionIds)];
    if (uniqueIds.length < 2) return;
    const key = `${fieldPath}|${[...uniqueIds].sort().join("|")}`;
    if (conflictKeys.has(key)) return;
    conflictKeys.add(key);
    conflicts.push({ fieldPath, assertionIds: uniqueIds, reason });
  };
  for (const source of sources) {
    for (const conflict of source.result.conflicts) {
      addConflict(
        conflict.fieldPath,
        conflict.assertionIds.flatMap(
          (assertionId2) => assertionIdsBySourceKeyMutable.get(sourceKey(source.scope, assertionId2)) ?? []
        ),
        conflict.explanation
      );
    }
    for (const assertion of source.result.assertions) {
      if (assertion.status !== "conflicting") continue;
      addConflict(
        assertion.fieldPath,
        assertionIdsBySourceKeyMutable.get(sourceKey(source.scope, assertion.id)) ?? [],
        assertion.explanation ?? "The document contains conflicting evidenced values."
      );
    }
  }
  const projectedByFieldAndEntity = /* @__PURE__ */ new Map();
  flatAssertions.forEach((assertion, index) => {
    const projected = projectedAssertions[index];
    if (!projected) return;
    const key = `${assertion.entityRef}|${assertion.fieldPath}`;
    const values = projectedByFieldAndEntity.get(key) ?? [];
    values.push({ id: projected.id, value: projected.normalizedValue });
    projectedByFieldAndEntity.set(key, values);
  });
  for (const [key, assertions] of projectedByFieldAndEntity) {
    const distinctValues = new Set(assertions.map((assertion) => stableValue(assertion.value)));
    if (distinctValues.size < 2) continue;
    const fieldPath = key.slice(key.indexOf("|") + 1);
    addConflict(
      fieldPath,
      assertions.map((assertion) => assertion.id),
      "Discovery and asset-coverage passes produced different evidenced values."
    );
  }
  const insurerName = findStringAssertion(sources, [
    /(?:^|\.)insurer\.name$/i,
    /(?:^|\.)carrierName$/i
  ]);
  const agencyName = findStringAssertion(sources, [
    /(?:^|\.)agency\.name$/i,
    /(?:^|\.)brokerName$/i
  ]);
  const parserId = assertionParserId(run.discovery);
  const parserVersion = assertionParserVersion(run.discovery);
  const document = ParsedInsuranceDocument.parse({
    classification: mapClassification(run.discovery, warnings),
    insurer: insurerName ? { name: insurerName } : void 0,
    agency: agencyName ? { name: agencyName } : void 0,
    policyTerms,
    assetAssertions: assets,
    coverageAssertions: flatAssertions.map((assertion, index) => ({ assertion, projected: projectedAssertions[index] })).filter(
      (entry) => entry.projected !== void 0 && (entry.assertion.factKind === "coverage" || entry.assertion.factKind === "premium")
    ).map((entry) => entry.projected),
    notices: flatAssertions.map((assertion, index) => ({ assertion, projected: projectedAssertions[index] })).filter(
      (entry) => entry.projected !== void 0 && entry.assertion.factKind === "notice"
    ).map((entry) => entry.projected),
    conflicts,
    parserId,
    parserVersion
  });
  return {
    document,
    warnings,
    assertionIdsBySourceKey: Object.fromEntries(
      [...assertionIdsBySourceKeyMutable.entries()].map(([key, ids]) => [
        key,
        Object.freeze([...ids])
      ])
    )
  };
}

// src/llm-identity-resolver.ts
function stringValue2(assertion) {
  const raw = assertion.normalizedValue ?? assertion.value;
  if (typeof raw === "string") return raw;
  if (raw == null) return void 0;
  return String(raw);
}
function numberValue(assertion) {
  const raw = assertion.normalizedValue ?? assertion.value;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : void 0;
  if (typeof raw === "string") {
    const parsed = Number(raw.replace(/[,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : void 0;
  }
  return void 0;
}
function fieldHint(fieldPath) {
  return fieldPath.toLowerCase().replace(/[_.[\]]/g, "");
}
function isMailingOrCorrespondence(fieldPath) {
  const hint = fieldHint(fieldPath);
  return hint.includes("mail") || hint.includes("correspondence") || hint.includes("broker") || hint.includes("agent");
}
function isAddressLine1Field(fieldPath) {
  const hint = fieldHint(fieldPath);
  return (hint.includes("address") || hint.includes("civic") || hint.includes("street")) && !isMailingOrCorrespondence(fieldPath);
}
function extractPropertyInput(asset, assertions) {
  const input = {};
  for (const assertion of assertions) {
    const hint = fieldHint(assertion.fieldPath);
    if (isAddressLine1Field(assertion.fieldPath)) {
      input.addressLine1 = stringValue2(assertion);
    } else if (hint.includes("unit") || hint.includes("apartment") || hint.includes("suite")) {
      input.unit = stringValue2(assertion);
    } else if (hint.includes("city")) {
      input.city = stringValue2(assertion);
    } else if (hint.includes("province") || hint.includes("state")) {
      input.province = stringValue2(assertion);
    } else if (hint.includes("postal") || hint.includes("zip")) {
      input.postalCode = stringValue2(assertion);
    } else if (hint.includes("occupancy") || hint.includes("occupant")) {
      const value = stringValue2(assertion);
      if (value === "principal_residence" || value === "rental") {
        input.occupancy = value;
      } else if (value === "seasonal") {
        input.occupancy = "principal_residence";
      } else if (value === "vacant") {
        input.occupancy = "rental";
      } else {
        input.occupancy = "unknown";
      }
    }
  }
  if (asset.assetType === "property") {
    input.occupancy = asset.occupancy === "principal_residence" || asset.occupancy === "rental" ? asset.occupancy : "unknown";
    input.isRedacted = asset.insuredLocationStatus === "redacted" || asset.insuredLocationStatus === "partial";
  }
  return input;
}
function extractVehicleInput(asset, assertions) {
  const input = {};
  for (const assertion of assertions) {
    const hint = fieldHint(assertion.fieldPath);
    if (hint.includes("vin") && !hint.includes("equipment")) {
      input.vin = stringValue2(assertion);
    } else if (hint.includes("modelyear") || hint.includes("year")) {
      input.modelYear = numberValue(assertion);
    } else if (hint.includes("make")) {
      input.make = stringValue2(assertion);
    } else if (hint.includes("model") && !hint.includes("modelyear") && !hint.includes("model_year")) {
      input.model = stringValue2(assertion);
    } else if (hint.includes("trim")) {
      input.trim = stringValue2(assertion);
    }
  }
  if (asset.assetType === "vehicle" && (asset.vinStatus === "redacted" || asset.vinStatus === "partial")) {
    input.vin = void 0;
  }
  return input;
}
function matchClassificationFromStrength(strength) {
  switch (strength) {
    case "exact":
      return "new";
    case "possible":
      return "possible_existing_match";
    case "confirmation_required":
      return "new_identity_confirmation_required";
  }
}
function resolveLlmAssetIdentity(input) {
  const { asset, identityAssertions } = input;
  if (asset.assetType === "property") {
    const propertyInput = extractPropertyInput(asset, identityAssertions);
    const result3 = buildPropertyIdentity(propertyInput);
    const fingerprint2 = result3.exactFingerprint ?? result3.possibleMatchHint ?? "";
    return {
      identityFingerprint: fingerprint2,
      matchClassification: result3.strength === "exact" ? "new" : matchClassificationFromStrength(result3.strength)
    };
  }
  const vehicleInput = extractVehicleInput(asset, identityAssertions);
  const result2 = buildVehicleIdentity(vehicleInput);
  const fingerprint = result2.exactFingerprint ?? result2.possibleMatchHint ?? "";
  return {
    identityFingerprint: fingerprint,
    matchClassification: result2.strength === "exact" ? "new" : matchClassificationFromStrength(result2.strength)
  };
}

// src/llm-pipeline.ts
var LLM_PIPELINE_VERSION = 1;
var DEFAULT_MAX_ATTEMPTS = 2;
var DEFAULT_ASSET_CONCURRENCY = 2;
function boundedInteger(value, fallback, minimum, maximum) {
  if (value === void 0 || !Number.isInteger(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, value));
}
function assertValidDocument(document) {
  if (!/^[a-f0-9]{64}$/i.test(document.fileDigest)) {
    throw new Error("Extracted PDF fileDigest must be a SHA-256 hex digest");
  }
  if (document.pages.length === 0) {
    throw new Error("Extracted PDF must contain at least one page");
  }
  if (document.pageCount !== document.pages.length) {
    throw new Error("Extracted PDF pageCount does not match its pages");
  }
  const pageNumbers = /* @__PURE__ */ new Set();
  for (const page of document.pages) {
    if (pageNumbers.has(page.pageNumber)) {
      throw new Error(`Extracted PDF contains duplicate page ${page.pageNumber}`);
    }
    pageNumbers.add(page.pageNumber);
  }
}
async function emit(handler, event) {
  if (handler) await handler(event);
}
function summarizeRequest(request) {
  if (request.pass.kind === "asset_coverage") {
    return {
      pass: request.pass.kind,
      assetLocalId: request.pass.targetAssetLocalId,
      pageNumbers: request.pages.map((page) => page.pageNumber)
    };
  }
  return {
    pass: request.pass.kind,
    pageNumbers: request.pages.map((page) => page.pageNumber)
  };
}
function requestAssetLocalId(request) {
  return request.pass.kind === "asset_coverage" ? request.pass.targetAssetLocalId : void 0;
}
function safeErrorName(error) {
  return error instanceof Error && error.name ? error.name : "UnknownError";
}
function repairPrompt(basePrompt, reason, issues) {
  const issueList = issues.filter((issue) => issue.severity === "error").slice(0, 20).map((issue) => `${issue.code}@${issue.path.join(".")}`).join(", ");
  return `${basePrompt}

The prior response was rejected. Return a complete replacement JSON object, not a patch. Failure category: ${reason}.${issueList ? ` Correct these deterministic validation failures: ${issueList}.` : ""} Do not repeat private values in warnings or explanations.`;
}
function providerIdentityMatches(result2, provider) {
  return result2.model.provider === provider.providerId && result2.model.model === provider.modelId;
}
function buildAssetCoveragePrompt(discovery, asset) {
  const identityAssertionIds = new Set(asset.identityAssertionIds);
  const identityFacts = discovery.assertions.filter((assertion) => identityAssertionIds.has(assertion.id)).map((assertion) => ({
    id: assertion.id,
    fieldPath: assertion.fieldPath,
    status: assertion.status,
    value: assertion.value,
    normalizedValue: assertion.normalizedValue,
    confidence: assertion.confidence,
    pageNumbers: assertion.evidence.map((evidence) => evidence.pageNumber)
  }));
  const policyTermIds = discovery.policyTerms.filter((term) => term.insuredAssetRefs.includes(asset.localId)).map((term) => term.localId);
  const context = JSON.stringify({
    asset: {
      localId: asset.localId,
      assetType: asset.assetType,
      displayLabel: asset.displayLabel,
      identityFacts,
      policyTermIds
    }
  });
  return `${buildInsuranceExtractionSystemPrompt("asset_coverage")}

Target asset context from the validated discovery pass:
${context}

Preserve this exact localId and assetType. Return exactly one asset: the target asset. Use the identity facts only to distinguish this asset from other properties or vehicles in the document; re-read the supplied pages for every coverage fact. Do not copy coverage from another asset that shares a policyholder, mailing address, or policy package.`;
}
async function executePass(input) {
  const { provider, request, systemPrompt, maxAttempts, enforceProviderIdentity, onEvent } = input;
  let prompt = systemPrompt;
  let lastValidation;
  let lastFailure;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const assetLocalId = requestAssetLocalId(request);
    await emit(onEvent, {
      type: "pass_started",
      documentId: request.documentId,
      pass: request.pass.kind,
      assetLocalId,
      attempt
    });
    let raw;
    try {
      raw = await provider.extract(request, prompt);
    } catch (error) {
      lastFailure = {
        code: "PROVIDER_ERROR",
        message: `LLM provider call failed (${safeErrorName(error)})`
      };
      if (attempt < maxAttempts) {
        await emit(onEvent, {
          type: "pass_retrying",
          documentId: request.documentId,
          pass: request.pass.kind,
          assetLocalId,
          attempt,
          reason: "provider_error"
        });
        prompt = repairPrompt(systemPrompt, "provider_error", []);
        continue;
      }
      break;
    }
    try {
      const validation = validateLlmExtractionSemantics(raw, request);
      lastValidation = validation;
      if (!validation.valid) {
        lastFailure = {
          code: "INVALID_MODEL_OUTPUT",
          message: "LLM output failed deterministic semantic validation"
        };
        if (attempt < maxAttempts) {
          await emit(onEvent, {
            type: "pass_retrying",
            documentId: request.documentId,
            pass: request.pass.kind,
            assetLocalId,
            attempt,
            reason: "validation_error"
          });
          prompt = repairPrompt(systemPrompt, "validation_error", validation.issues);
          continue;
        }
        break;
      }
      const result2 = parseLlmExtractionResult(raw, request);
      if (enforceProviderIdentity && !providerIdentityMatches(result2, provider)) {
        lastFailure = {
          code: "MODEL_IDENTITY_MISMATCH",
          message: "LLM output model identity does not match the configured provider"
        };
        if (attempt < maxAttempts) {
          await emit(onEvent, {
            type: "pass_retrying",
            documentId: request.documentId,
            pass: request.pass.kind,
            assetLocalId,
            attempt,
            reason: "model_identity_mismatch"
          });
          prompt = repairPrompt(systemPrompt, "model_identity_mismatch", []);
          continue;
        }
        break;
      }
      await emit(onEvent, {
        type: "pass_completed",
        documentId: request.documentId,
        pass: request.pass.kind,
        assetLocalId,
        attempt,
        warningCount: validation.issues.filter((issue) => issue.severity === "warning").length
      });
      return {
        status: "completed",
        attempts: attempt,
        request: summarizeRequest(request),
        result: result2,
        validation
      };
    } catch (error) {
      lastFailure = {
        code: "INVALID_MODEL_OUTPUT",
        message: `LLM output did not match the extraction contract (${safeErrorName(error)})`
      };
      if (attempt < maxAttempts) {
        await emit(onEvent, {
          type: "pass_retrying",
          documentId: request.documentId,
          pass: request.pass.kind,
          assetLocalId,
          attempt,
          reason: "validation_error"
        });
        prompt = repairPrompt(systemPrompt, "validation_error", []);
        continue;
      }
    }
  }
  return {
    status: lastFailure?.code === "PROVIDER_ERROR" ? "provider_error" : "invalid_output",
    attempts: maxAttempts,
    request: summarizeRequest(request),
    validation: lastValidation,
    failure: lastFailure ?? {
      code: "INVALID_MODEL_OUTPUT",
      message: "LLM extraction pass did not produce a valid result"
    }
  };
}
async function toPageInputs(document, pages, resolver) {
  return Promise.all(
    pages.map(async (page) => {
      const imageRef = resolver ? await resolver(document.documentId, page.pageNumber) : void 0;
      return imageRef ? { pageNumber: page.pageNumber, text: page.text, imageRef } : { pageNumber: page.pageNumber, text: page.text };
    })
  );
}
function selectPages(document, pageNumbers) {
  const unique = [...new Set(pageNumbers)];
  if (unique.length === 0) {
    throw new Error("Coverage page selector returned no pages");
  }
  const pagesByNumber = new Map(document.pages.map((page) => [page.pageNumber, page]));
  return unique.map((pageNumber) => {
    const page = pagesByNumber.get(pageNumber);
    if (!page) {
      throw new Error(`Coverage page selector returned unknown page ${pageNumber}`);
    }
    return page;
  }).sort((left, right) => left.pageNumber - right.pageNumber);
}
async function mapInBatches(values, concurrency, mapper) {
  const output = [];
  for (let index = 0; index < values.length; index += concurrency) {
    const batch = values.slice(index, index + concurrency);
    output.push(...await Promise.all(batch.map(mapper)));
  }
  return output;
}
function assetTypeChanged(asset, pass) {
  const returned = pass.result?.assets.find((candidate) => candidate.localId === asset.localId);
  return Boolean(returned && returned.assetType !== asset.assetType);
}
function pipelineFailure(asset, pageNumbers, error) {
  return {
    asset,
    pass: {
      status: "pipeline_error",
      attempts: 0,
      request: {
        pass: "asset_coverage",
        assetLocalId: asset.localId,
        pageNumbers
      },
      failure: {
        code: "PIPELINE_ERROR",
        message: `Asset coverage pipeline failed before a valid result (${safeErrorName(error)})`
      }
    }
  };
}
function withRequestedModel(request, requestedModel) {
  return requestedModel ? { ...request, requestedModel } : request;
}
async function runInsuranceLlmPipeline(document, provider, options = {}) {
  assertValidDocument(document);
  const maxAttempts = boundedInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS, 1, 3);
  const concurrency = boundedInteger(
    options.maxConcurrentAssetPasses,
    DEFAULT_ASSET_CONCURRENCY,
    1,
    4
  );
  const enforceProviderIdentity = options.enforceProviderIdentity ?? true;
  const orderedPages = [...document.pages].sort(
    (left, right) => left.pageNumber - right.pageNumber
  );
  const discoveryPages = await toPageInputs(document, orderedPages, options.resolvePageImageRef);
  const discoveryRequest = withRequestedModel(
    {
      documentId: document.documentId,
      fileDigest: document.fileDigest,
      pages: discoveryPages,
      pass: { kind: "discovery" }
    },
    options.requestedModel
  );
  const discovery = await executePass({
    provider,
    request: discoveryRequest,
    systemPrompt: buildInsuranceExtractionSystemPrompt("discovery"),
    maxAttempts,
    enforceProviderIdentity,
    onEvent: options.onEvent
  });
  if (discovery.status !== "completed" || !discovery.result) {
    return {
      pipelineVersion: LLM_PIPELINE_VERSION,
      documentId: document.documentId,
      fileDigest: document.fileDigest,
      providerId: provider.providerId,
      modelId: provider.modelId,
      discovery,
      assetCoverage: [],
      complete: false,
      requiresManualReview: true,
      warnings: ["Document discovery failed; coverage extraction was not attempted"]
    };
  }
  const discoveryResult = discovery.result;
  if (["unsupported", "unknown"].includes(discoveryResult.classification)) {
    return {
      pipelineVersion: LLM_PIPELINE_VERSION,
      documentId: document.documentId,
      fileDigest: document.fileDigest,
      providerId: provider.providerId,
      modelId: provider.modelId,
      discovery,
      assetCoverage: [],
      complete: false,
      requiresManualReview: true,
      warnings: ["Document classification requires manual review"]
    };
  }
  const assetCoverage = await mapInBatches(
    discoveryResult.assets,
    concurrency,
    async (asset) => {
      let selectedNumbers = orderedPages.map((page) => page.pageNumber);
      try {
        if (options.selectCoveragePageNumbers) {
          selectedNumbers = await options.selectCoveragePageNumbers({
            document,
            discovery: discoveryResult,
            asset
          });
        }
        const selected = selectPages(document, selectedNumbers);
        const pages = await toPageInputs(document, selected, options.resolvePageImageRef);
        const request = withRequestedModel(
          {
            documentId: document.documentId,
            fileDigest: document.fileDigest,
            pages,
            pass: {
              kind: "asset_coverage",
              targetAssetLocalId: asset.localId,
              relevantPageNumbers: selected.map((page) => page.pageNumber)
            }
          },
          options.requestedModel
        );
        const pass = await executePass({
          provider,
          request,
          systemPrompt: buildAssetCoveragePrompt(discoveryResult, asset),
          maxAttempts,
          enforceProviderIdentity,
          onEvent: options.onEvent
        });
        if (assetTypeChanged(asset, pass)) {
          return {
            asset,
            pass: {
              ...pass,
              status: "invalid_output",
              failure: {
                code: "ASSET_TYPE_CHANGED",
                message: "Coverage extraction changed the discovered asset type"
              }
            }
          };
        }
        return { asset, pass };
      } catch (error) {
        return pipelineFailure(asset, selectedNumbers, error);
      }
    }
  );
  const hasAssets = discoveryResult.assets.length > 0;
  const complete = hasAssets && assetCoverage.every((entry) => entry.pass.status === "completed");
  const executions = [discovery, ...assetCoverage.map((entry) => entry.pass)];
  const validationWarnings = executions.reduce(
    (total, execution) => total + (execution.validation?.issues.filter((issue) => issue.severity === "warning").length ?? 0),
    0
  );
  const uncertainIdentity = discoveryResult.assets.some(
    (asset) => asset.proposedMatchClassification !== "new" || asset.assetType === "property" && asset.insuredLocationStatus !== "complete" || asset.assetType === "vehicle" && asset.vinStatus !== "valid_appearing"
  );
  return {
    pipelineVersion: LLM_PIPELINE_VERSION,
    documentId: document.documentId,
    fileDigest: document.fileDigest,
    providerId: provider.providerId,
    modelId: provider.modelId,
    discovery,
    assetCoverage,
    complete,
    requiresManualReview: !complete || !hasAssets || validationWarnings > 0 || uncertainIdentity,
    warnings: [
      ...!hasAssets ? ["Discovery returned no insured assets"] : [],
      ...!complete && hasAssets ? ["One or more asset coverage passes failed"] : [],
      ...validationWarnings > 0 ? [`Deterministic validation produced ${validationWarnings} warning(s)`] : [],
      ...uncertainIdentity ? ["At least one asset identity requires review"] : []
    ]
  };
}

// src/llm-providers/http.ts
function stripMarkdownJsonFence(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    const lines = trimmed.split("\n");
    if (lines.length > 1 && lines[0].trim().toLowerCase().startsWith("```json")) {
      return lines.slice(1, -1).join("\n").trim();
    }
    if (lines.length > 1 && lines[0].trim().startsWith("```")) {
      return lines.slice(1, -1).join("\n").trim();
    }
  }
  return trimmed;
}
var HttpLlmProvider = class {
  providerId;
  modelId;
  supportsNativePdfInput;
  supportsImageInput;
  apiUrl;
  apiKey;
  constructor(options) {
    const url = options.apiUrl.replace(/\/+$/, "");
    this.apiUrl = `${url}/chat/completions`;
    this.apiKey = options.apiKey;
    this.modelId = options.model;
    this.providerId = options.providerId ?? "http-llm-provider";
    this.supportsNativePdfInput = options.supportsNativePdfInput ?? false;
    this.supportsImageInput = options.supportsImageInput ?? false;
  }
  async extract(request, systemPrompt) {
    let messages;
    if (typeof request === "object" && request !== null && "content" in request && Array.isArray(request.content)) {
      messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: request.content }
      ];
    } else {
      messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(request) }
      ];
    }
    const response = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.modelId,
        temperature: 0,
        messages
      })
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`LLM request failed: ${response.status} ${text.slice(0, 200)}`);
    }
    const body = await response.json();
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("LLM response did not contain a text completion");
    }
    const jsonText = stripMarkdownJsonFence(content);
    return JSON.parse(jsonText);
  }
};

// src/entity-resolution.ts
function candidatePostalCode(candidate) {
  return candidate.assertions.find(
    (a) => a.fieldPath === "property.postalCode" && a.addressRole === "insured_location"
  )?.normalizedValue;
}
function candidateCityProvincePostal(candidate) {
  const city = candidate.assertions.find(
    (a) => a.fieldPath === "property.city" && a.addressRole === "insured_location"
  )?.normalizedValue;
  const province = candidate.assertions.find(
    (a) => a.fieldPath === "property.province" && a.addressRole === "insured_location"
  )?.normalizedValue;
  const postal = candidatePostalCode(candidate);
  if (!city || !province || !postal) return void 0;
  return [city, province, postal].join(" ").toUpperCase().replace(/\s+/g, " ");
}
function isPostalOnlyFingerprint(candidate) {
  const cpp = candidateCityProvincePostal(candidate);
  if (!cpp) return true;
  return candidate.identityFingerprint.toUpperCase().replace(/\s+/g, " ") === cpp;
}
function classifyPropertyCandidate(candidate, householdAssets) {
  if (candidate.matchClassification === "new_identity_confirmation_required") {
    return "new_identity_confirmation_required";
  }
  const postal = candidatePostalCode(candidate);
  const postalOnly = isPostalOnlyFingerprint(candidate);
  const exactHousehold = householdAssets.some(
    (a) => a.assetType === "property" && a.identityFingerprint === candidate.identityFingerprint
  );
  if (!postalOnly && exactHousehold) return "exact_existing_match";
  if (postal) {
    const samePostal = householdAssets.some(
      (a) => a.assetType === "property" && a.identityFingerprint !== candidate.identityFingerprint && a.identityFingerprint.toUpperCase().includes(postal.toUpperCase())
    );
    if (samePostal) return "possible_existing_match";
  }
  return candidate.matchClassification ?? "new";
}
function classifyVehicleCandidate(candidate, householdAssets) {
  if (householdAssets.some(
    (a) => a.assetType === "vehicle" && a.identityFingerprint === candidate.identityFingerprint
  )) {
    return "exact_existing_match";
  }
  return candidate.matchClassification ?? "new";
}
function resolveParsedDocuments({
  householdAssets = [],
  existingCandidates = [],
  parsedDocuments
}) {
  const seenDigests = /* @__PURE__ */ new Set();
  const documents = [];
  for (const d of parsedDocuments) {
    if (!d.fileDigest || seenDigests.has(d.fileDigest)) continue;
    seenDigests.add(d.fileDigest);
    documents.push(d);
  }
  const allExisting = [
    ...householdAssets,
    ...existingCandidates.map((c) => ({
      assetType: c.assetType,
      identityFingerprint: c.identityFingerprint
    }))
  ];
  const conflicts = [];
  const candidatesByKey = /* @__PURE__ */ new Map();
  for (const doc of documents) {
    for (const asset of doc.assetAssertions) {
      const key = `${asset.assetType}:${asset.identityFingerprint}`;
      if (candidatesByKey.has(key)) continue;
      let matchClassification = asset.matchClassification === "new_identity_confirmation_required" ? "new_identity_confirmation_required" : void 0;
      if (asset.assetType === "property") {
        matchClassification = matchClassification ?? classifyPropertyCandidate(asset, allExisting);
      } else if (asset.assetType === "vehicle") {
        matchClassification = classifyVehicleCandidate(asset, allExisting);
      } else {
        matchClassification = matchClassification ?? asset.matchClassification ?? "new";
      }
      const resolved = { ...asset, matchClassification };
      candidatesByKey.set(key, resolved);
    }
    conflicts.push(...doc.conflicts);
  }
  const candidates = [...candidatesByKey.values()];
  return { candidates, documents, conflicts };
}

// src/providers/public-error.ts
var CUSTOMER_FACING_MESSAGES = {
  DOCUMENT_FILE_UNSUPPORTED: "This file type is not currently supported for document analysis.",
  DOCUMENT_FILE_TOO_LARGE: "This file is too large for document analysis.",
  DOCUMENT_PROCESSING_FAILED: "Document processing failed. Please try again or contact support.",
  DOCUMENT_ANALYSIS_UNAVAILABLE: "Document analysis is temporarily unavailable. Please try again later.",
  DOCUMENT_ANALYSIS_FAILED: "Document analysis failed. Please try again or contact support.",
  DOCUMENT_MODEL_UNAVAILABLE: "Document analysis is temporarily unavailable. Please try again later.",
  DOCUMENT_PROCESSING_AUTHORIZATION_REQUIRED: "Review and accept the document-processing notice before analyzing these files."
};
function sanitizeProviderError(error, supportReference) {
  const supportId = supportReference ?? generateSupportReference();
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  let code = "DOCUMENT_ANALYSIS_FAILED";
  let retryable = false;
  if (lower.includes("not authorized") || lower.includes("consent required") || lower.includes("consent withdrawn") || lower.includes("privacy notice")) {
    code = "DOCUMENT_PROCESSING_AUTHORIZATION_REQUIRED";
    retryable = false;
  } else if (lower.includes("unsupported file") || lower.includes("file type") || lower.includes("invalid file") || lower.includes("not currently supported")) {
    code = "DOCUMENT_FILE_UNSUPPORTED";
  } else if (lower.includes("too large")) {
    code = "DOCUMENT_FILE_TOO_LARGE";
  } else if (lower.includes("rate limit") || lower.includes("temporarily unavailable") || lower.includes("503") || lower.includes("timeout") || lower.includes("not enabled") || lower.includes("not approved") || lower.includes("consent") || lower.includes("privacy notice")) {
    code = "DOCUMENT_ANALYSIS_UNAVAILABLE";
    retryable = !lower.includes("not enabled") && !lower.includes("not approved");
  } else if (lower.includes("model unavailable") || lower.includes("model is not available") || lower.includes("not found")) {
    code = "DOCUMENT_MODEL_UNAVAILABLE";
  } else if (lower.includes("processing failed")) {
    code = "DOCUMENT_PROCESSING_FAILED";
  }
  return {
    code,
    message: CUSTOMER_FACING_MESSAGES[code],
    retryable,
    supportReference: supportId
  };
}
function generateSupportReference() {
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function publicErrorResponse(error) {
  return { error };
}

// src/document-analyzer.ts
var AnalysisVersion = z.literal("1");
var GENERIC_PARSER_ID = "native-document-analysis";
var GENERIC_PARSER_VERSION = "1.0.0";
var UploadedDocumentSchema = z.object({
  documentId: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  fileReference: z.string().min(1)
}).strict();
var CandidateIdentitySchema = z.object({
  exactIdentityFingerprint: z.string().nullable(),
  provisionalCandidateKey: z.string().min(1),
  identityStrength: z.enum(["exact", "partial", "redacted", "unknown"])
}).strict();
var ExistingHouseholdAssetSchema = z.object({
  id: z.string().min(1),
  assetType: z.enum(["property", "vehicle"]),
  identityFingerprint: z.string().min(1),
  displayLabel: z.string().optional(),
  candidateIdentity: z.lazy(() => CandidateIdentitySchema).optional(),
  identity: z.lazy(() => DetectedEntityIdentitySchema).optional(),
  currentPolicy: z.lazy(() => CurrentPolicySchema).optional()
}).strict();
var PendingEntityCandidateSchema = z.object({
  id: z.string().min(1),
  assetType: z.enum(["property", "vehicle"]),
  identityFingerprint: z.string().min(1),
  displayLabel: z.string().optional(),
  candidateIdentity: z.lazy(() => CandidateIdentitySchema).optional(),
  identity: z.lazy(() => DetectedEntityIdentitySchema).optional(),
  currentPolicy: z.lazy(() => CurrentPolicySchema).optional()
}).strict();
var PriorDocumentSummarySchema = z.object({
  documentId: z.string().min(1),
  fileDigest: z.string().min(1).optional(),
  classification: z.string().optional(),
  detectedEntityCount: z.number().int().nonnegative()
}).strict();
var InsuranceDocumentAnalysisInputSchema = z.object({
  householdId: z.string().min(1),
  uploadedDocuments: z.array(UploadedDocumentSchema).min(1),
  existingAssets: z.array(ExistingHouseholdAssetSchema).default([]),
  pendingCandidates: z.array(PendingEntityCandidateSchema).default([]),
  priorDocumentSummaries: z.array(PriorDocumentSummarySchema).default([]),
  jurisdiction: z.enum(["AB"]).default("AB")
}).strict();
var EvidenceReferenceSchema = z.object({
  documentId: z.string().min(1),
  pageNumber: z.number().int().positive().optional(),
  quotedLabel: z.string().optional(),
  evidenceSummary: z.string().min(1)
}).strict();
var ExtractedAlternativeValueSchema = z.object({
  value: z.unknown(),
  evidence: z.array(EvidenceReferenceSchema).min(1),
  explanation: z.string().optional()
}).strict();
var ExtractedCurrentValueSchema = z.object({
  status: z.enum(["known", "unknown", "not_included", "not_applicable", "conflicting"]),
  value: z.unknown(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(EvidenceReferenceSchema).min(1).optional(),
  alternatives: z.array(ExtractedAlternativeValueSchema).min(2).optional(),
  explanation: z.string().optional()
}).strict();
var DetectedEntityIdentitySchema = z.object({
  fullAddress: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  province: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  occupancy: z.enum(["principal_residence", "rental", "other", "unknown"]).nullable().optional(),
  vin: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
  make: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  trim: z.string().nullable().optional(),
  vehicleUse: z.string().nullable().optional()
}).strict();
var EntityResolutionStatusSchema = z.enum([
  "new",
  "matches_existing",
  "matches_pending_candidate",
  "possible_match_requires_confirmation"
]);
var EntityResolutionSchema = z.object({
  status: EntityResolutionStatusSchema,
  matchedExistingEntityId: z.string().nullable().optional(),
  matchedPendingCandidateId: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1)
}).strict();
var CurrentPolicySchema = z.object({
  insurer: z.string().nullable().optional(),
  policyNumber: z.string().nullable().optional(),
  effectiveDate: z.string().nullable().optional(),
  expiryDate: z.string().nullable().optional(),
  annualPremiumCents: z.number().int().nullable().optional()
}).strict();
var MandateRuleSchema = z.union([
  z.object({ rule: z.literal("minimum"), amountCents: z.number().int().positive() }).strict(),
  z.object({ rule: z.literal("maximum"), amountCents: z.number().int().nonnegative() }).strict(),
  z.object({ rule: z.literal("match_current_or_better"), value: z.string().min(1) }).strict(),
  z.object({ rule: z.literal("required") }).strict(),
  z.object({ rule: z.literal("any"), reason: z.string().optional() }).strict()
]);
var DetectedInsuranceEntitySchema = z.object({
  temporaryId: z.string().min(1),
  canonicalFingerprint: z.string().min(1),
  candidateIdentity: CandidateIdentitySchema,
  entityType: z.enum(["property", "vehicle"]),
  displayLabel: z.string().min(1),
  identity: DetectedEntityIdentitySchema,
  resolution: EntityResolutionSchema,
  currentPolicy: CurrentPolicySchema,
  currentCoverage: z.record(z.string().min(1), ExtractedCurrentValueSchema),
  mandateSuggestions: z.record(z.string().min(1), MandateRuleSchema),
  evidence: z.array(EvidenceReferenceSchema).default([]),
  requiredConfirmations: z.array(z.string().min(1)).default([])
}).strict();
var AnalyzedDocumentSchema = z.object({
  documentId: z.string().min(1),
  fileDigest: z.string().min(1),
  classification: z.string().min(1),
  parserId: z.string().min(1),
  parserVersion: z.string().min(1),
  pageCount: z.number().int().nonnegative(),
  extractedEntityCount: z.number().int().nonnegative()
}).strict();
var DetectedConflictSchema = z.object({
  fieldPath: z.string().min(1),
  entityRef: z.string().min(1),
  assertionIds: z.array(z.string().min(1)).min(1),
  explanation: z.string().min(1),
  requiresHumanResolution: z.boolean()
}).strict();
var AnalysisWarningSchema = z.object({
  message: z.string().min(1),
  documentId: z.string().nullable().optional()
}).strict().transform((w) => {
  const out = { message: w.message };
  if (w.documentId) out.documentId = w.documentId;
  return out;
});
var InsuranceDocumentAnalysisResultSchema = z.object({
  analysisVersion: AnalysisVersion,
  modelProvider: z.string().min(1),
  modelId: z.string().min(1),
  documents: z.array(AnalyzedDocumentSchema),
  detectedEntities: z.array(DetectedInsuranceEntitySchema),
  unresolvedConflicts: z.array(DetectedConflictSchema),
  warnings: z.array(AnalysisWarningSchema),
  attemptedModelProvider: z.string().min(1).optional(),
  attemptedModelId: z.string().min(1).optional(),
  fallbackReason: z.string().optional(),
  rawResponse: z.unknown().nullable().optional(),
  attemptCount: z.number().int().positive().optional(),
  promptVersion: z.string().optional(),
  outputSchemaVersion: z.string().optional(),
  providerMetadata: z.unknown().optional()
}).strict();
function valueForFieldPath(assertions, fieldPath) {
  return assertions.find((a) => a.fieldPath === fieldPath)?.normalizedValue;
}
function authorityRank2(authority) {
  const order = [
    "coverage_summary",
    "insurance_certificate",
    "active_endorsement",
    "endorsement",
    "invoice",
    "renewal_overview",
    "notice",
    "informational_notice",
    "policy_wording",
    "header_footer",
    "unknown"
  ];
  const index = order.indexOf(authority);
  return index === -1 ? order.length : index;
}
function statusFromPresence(presence) {
  switch (presence) {
    case "included":
      return "known";
    case "not_included":
      return "not_included";
    case "not_applicable":
      return "not_applicable";
    case "unknown":
    default:
      return "unknown";
  }
}
function isOptionalCoverageBoolean(fieldPath) {
  return /Included$/i.test(fieldPath) || /Coverage$/i.test(fieldPath);
}
function buildCurrentCoverage(candidate, documentId) {
  const coverage = {};
  const sorted = [...candidate.assertions].sort(
    (a, b) => authorityRank2(a.authority) - authorityRank2(b.authority)
  );
  for (const assertion of sorted) {
    if (assertion.entityScope !== "coverage") {
      continue;
    }
    const fieldPath = assertion.fieldPath;
    if (Object.prototype.hasOwnProperty.call(coverage, fieldPath)) {
      continue;
    }
    let status;
    let value = null;
    const confidence = assertion.confidence;
    if (isOptionalCoverageBoolean(fieldPath)) {
      const presence = assertion.coveragePresence;
      status = statusFromPresence(presence);
      value = presence === "included" ? true : presence === "not_included" ? false : null;
    } else if (typeof assertion.normalizedValue === "number" && assertion.normalizedValue > 0) {
      status = "known";
      value = assertion.normalizedValue;
    } else if (typeof assertion.normalizedValue === "string" && assertion.normalizedValue.length > 0) {
      status = "known";
      value = assertion.normalizedValue;
    } else if (assertion.coveragePresence) {
      status = statusFromPresence(assertion.coveragePresence);
      value = null;
    } else {
      status = "unknown";
      value = null;
    }
    if (status === "unknown") {
      coverage[fieldPath] = { status, value, confidence };
    } else {
      coverage[fieldPath] = {
        status,
        value,
        confidence,
        evidence: [
          { documentId, pageNumber: assertion.pageNumber, evidenceSummary: assertion.rawText }
        ]
      };
    }
  }
  return coverage;
}
function suggestMandate(fieldPath, current) {
  if (current.status === "unknown") {
    return void 0;
  }
  if (current.status === "not_applicable") {
    return { rule: "any", reason: `current value is ${current.status}` };
  }
  if (current.status === "not_included") {
    return { rule: "any", reason: "currently not included" };
  }
  if (isOptionalCoverageBoolean(fieldPath) && current.status === "known") {
    return current.value === true ? { rule: "required" } : { rule: "any", reason: "currently not included" };
  }
  const value = current.value;
  if (typeof value !== "number" || value <= 0) {
    if (typeof value === "string" && String(value).length > 0) {
      if (fieldPath.includes("Form") || fieldPath.includes("form")) {
        return { rule: "match_current_or_better", value: String(value) };
      }
      return { rule: "any", reason: "no mandateable numeric or form value" };
    }
    return { rule: "any", reason: "no numeric value to preserve" };
  }
  if (fieldPath.endsWith("DeductibleCents")) {
    return { rule: "maximum", amountCents: value };
  }
  if (fieldPath.endsWith("LimitCents") || fieldPath.endsWith("limitCents") || fieldPath.includes("Liability")) {
    return { rule: "minimum", amountCents: value };
  }
  if (fieldPath.includes("Form") || fieldPath.includes("form")) {
    return { rule: "match_current_or_better", value: String(value) };
  }
  return { rule: "any", reason: "field is not mandateable" };
}
function buildMandateSuggestions(currentCoverage) {
  const suggestions = {};
  for (const [fieldPath, current] of Object.entries(currentCoverage)) {
    const rule = suggestMandate(fieldPath, current);
    if (rule) {
      suggestions[fieldPath] = rule;
    }
  }
  return suggestions;
}
function nullableString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function nullableNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[,\s]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
function buildIdentity(candidate) {
  if (candidate.assetType === "vehicle") {
    return {
      vin: nullableString(valueForFieldPath(candidate.assertions, "vehicle.vin")),
      year: nullableNumber(valueForFieldPath(candidate.assertions, "vehicle.year")),
      make: nullableString(valueForFieldPath(candidate.assertions, "vehicle.make")),
      model: nullableString(valueForFieldPath(candidate.assertions, "vehicle.model")),
      trim: nullableString(valueForFieldPath(candidate.assertions, "vehicle.trim")),
      vehicleUse: nullableString(valueForFieldPath(candidate.assertions, "vehicle.vehicleUse"))
    };
  }
  const occupancy = valueForFieldPath(candidate.assertions, "property.occupancy");
  return {
    fullAddress: nullableString(valueForFieldPath(candidate.assertions, "property.streetAddress")),
    city: nullableString(valueForFieldPath(candidate.assertions, "property.city")),
    province: nullableString(valueForFieldPath(candidate.assertions, "property.province")),
    postalCode: nullableString(valueForFieldPath(candidate.assertions, "property.postalCode")),
    occupancy: occupancy === "principal_residence" || occupancy === "rental" ? occupancy : "unknown"
  };
}
function buildCurrentPolicy(candidate, doc) {
  const term = doc.policyTerms[0] ?? {};
  const policyNumber = nullableString(
    term.policyNumber ?? valueForFieldPath(candidate.assertions, "policy.policyNumber")
  );
  const premium = nullableNumber(
    term.annualPremiumCents ?? valueForFieldPath(candidate.assertions, "policy.annualPremiumCents")
  );
  return {
    insurer: nullableString(doc.insurer?.name) ?? null,
    policyNumber,
    effectiveDate: nullableString(term.effectiveDate),
    expiryDate: nullableString(term.expiryDate),
    annualPremiumCents: premium
  };
}
function findPossibleMatch(candidate, candidateFingerprint, existingByFingerprint, pendingByFingerprint) {
  if (candidate.assetType === "vehicle") {
    for (const map of [existingByFingerprint, pendingByFingerprint]) {
      const exact = map.get(candidateFingerprint);
      if (exact) return exact;
    }
  }
  if (candidate.assetType === "property") {
    const postal = stringAssertion(candidate.assertions, "property.postalCode");
    if (postal) {
      for (const map of [existingByFingerprint, pendingByFingerprint]) {
        for (const value of map.values()) {
          if (value.assetType === "property" && value.identityFingerprint.toUpperCase().includes(postal.toUpperCase())) {
            return value;
          }
        }
      }
    }
  }
  return void 0;
}
function mapResolution(candidate, candidateFingerprint, existingByFingerprint, pendingByFingerprint) {
  if (candidate.matchClassification === "exact_existing_match") {
    const existing = existingByFingerprint.get(candidateFingerprint);
    if (existing) {
      return {
        status: "matches_existing",
        matchedExistingEntityId: existing.id,
        confidence: 0.99,
        reasoning: "Exact identity fingerprint matches an existing household asset."
      };
    }
    const pending = pendingByFingerprint.get(candidateFingerprint);
    if (pending) {
      return {
        status: "matches_pending_candidate",
        matchedPendingCandidateId: pending.id,
        confidence: 0.99,
        reasoning: "Exact identity fingerprint matches a pending candidate from an earlier upload."
      };
    }
  }
  if (candidate.matchClassification === "possible_existing_match") {
    const possible = findPossibleMatch(
      candidate,
      candidateFingerprint,
      existingByFingerprint,
      pendingByFingerprint
    );
    if (possible && "identityFingerprint" in possible) {
      const isPending = !("displayLabel" in possible);
      return {
        status: "possible_match_requires_confirmation",
        ...isPending ? { matchedPendingCandidateId: possible.id } : { matchedExistingEntityId: possible.id },
        confidence: 0.75,
        reasoning: "A possible match was found based on a partial identity (postal code, year/make/model, etc.)."
      };
    }
    return {
      status: "possible_match_requires_confirmation",
      confidence: 0.75,
      reasoning: "A possible match was found based on a partial identity (postal code, year/make/model, etc.)."
    };
  }
  if (candidate.matchClassification === "new_identity_confirmation_required") {
    return {
      status: "possible_match_requires_confirmation",
      confidence: 0.5,
      reasoning: "Identity is partial or redacted and requires customer confirmation before it can be matched."
    };
  }
  return {
    status: "new",
    confidence: 0.95,
    reasoning: "No existing or pending asset matches the normalized identity fingerprint."
  };
}
async function buildDetectedEntity(candidate, doc, documentId, existingByFingerprint, pendingByFingerprint) {
  const currentPolicy = buildCurrentPolicy(candidate, doc);
  const identity = buildIdentity(candidate);
  const candidateIdentity = await buildCandidateIdentity(identity, candidate.assetType);
  const canonicalFingerprint = candidateIdentity.exactIdentityFingerprint ?? candidateIdentity.provisionalCandidateKey;
  const currentCoverage = buildCurrentCoverage(candidate, documentId);
  const requiredConfirmations = [];
  if (candidate.matchClassification === "new_identity_confirmation_required") {
    requiredConfirmations.push(
      "Confirm the insured address or VIN because the extracted identity is partial or redacted."
    );
  }
  if (candidate.matchClassification === "possible_existing_match") {
    requiredConfirmations.push(
      "Confirm whether this asset matches an existing property or vehicle."
    );
  }
  return {
    temporaryId: generateOpaqueId(),
    canonicalFingerprint,
    candidateIdentity,
    entityType: candidate.assetType,
    displayLabel: candidate.displayLabel,
    identity,
    resolution: mapResolution(
      candidate,
      canonicalFingerprint,
      existingByFingerprint,
      pendingByFingerprint
    ),
    currentPolicy,
    currentCoverage,
    mandateSuggestions: buildMandateSuggestions(currentCoverage),
    evidence: candidate.assertions.filter(
      (a) => a.entityScope !== "notice" && typeof a.rawText === "string" && a.rawText.trim().length > 0
    ).slice(0, 10).map((a) => ({
      documentId,
      pageNumber: a.pageNumber,
      evidenceSummary: `${a.fieldPath}: ${a.rawText.trim().slice(0, 200)}`
    })),
    requiredConfirmations
  };
}
function buildAnalyzedDocument(doc) {
  return {
    documentId: doc.documentId ?? "unknown",
    fileDigest: doc.fileDigest ?? "unknown",
    classification: doc.classification,
    parserId: GENERIC_PARSER_ID,
    parserVersion: GENERIC_PARSER_VERSION,
    pageCount: doc.pageCount ?? 0,
    extractedEntityCount: doc.assetAssertions.length
  };
}
function stringAssertion(assertions, fieldPath) {
  const value = assertions.find((a) => a.fieldPath === fieldPath)?.normalizedValue;
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return void 0;
}
function numberAssertion(assertions, fieldPath) {
  const value = assertions.find((a) => a.fieldPath === fieldPath)?.normalizedValue;
  if (typeof value === "number") return Number.isFinite(value) ? value : void 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : void 0;
  }
  return void 0;
}
function isRedactedOrPlaceholder2(input) {
  if (!input) return true;
  const normalized = input.toUpperCase().replace(/\s+/g, " ");
  const markers = ["REDACTED", "WITHHELD", "NOT PROVIDED", "UNKNOWN", "XXXX", "****", "\u2022\u2022\u2022\u2022"];
  return markers.some((m) => normalized.includes(m)) || normalized === "";
}
function recomputePropertyIdentity(asset) {
  const street = stringAssertion(asset.assertions, "property.streetAddress");
  const city = stringAssertion(asset.assertions, "property.city");
  const province = stringAssertion(asset.assertions, "property.province");
  const postal = stringAssertion(asset.assertions, "property.postalCode");
  const occupancy = stringAssertion(
    asset.assertions,
    "property.occupancy"
  );
  const input = {
    addressLine1: street,
    city,
    province,
    postalCode: postal,
    occupancy,
    isRedacted: isRedactedOrPlaceholder2(street)
  };
  const result2 = buildPropertyIdentity(input);
  const fingerprint = result2.exactFingerprint ?? result2.possibleMatchHint ?? "";
  const display = result2.normalizedAddressLine1 && result2.normalizedCity ? `${result2.normalizedAddressLine1} ${result2.normalizedCity} ${result2.normalizedProvince ?? ""} ${result2.normalizedPostalCode ?? ""}`.trim() : `${occupancy ?? ""} ${result2.normalizedCity ?? city ?? ""} ${result2.normalizedProvince ?? province ?? ""} ${result2.normalizedPostalCode ?? postal ?? ""}`.trim();
  if (!fingerprint) {
    const fallback = display.toUpperCase().replace(/[^A-Z0-9]/g, "-") || "unidentified";
    return {
      identityFingerprint: `property:unknown:${fallback}`,
      displayLabel: display || "Unidentified property",
      matchClassification: "new_identity_confirmation_required"
    };
  }
  if (result2.strength === "exact") {
    return {
      identityFingerprint: fingerprint,
      displayLabel: display || fingerprint,
      matchClassification: "new"
    };
  }
  if (result2.strength === "confirmation_required") {
    return {
      identityFingerprint: fingerprint,
      displayLabel: display || fingerprint,
      matchClassification: "possible_existing_match"
    };
  }
  return {
    identityFingerprint: fingerprint,
    displayLabel: display || fingerprint,
    matchClassification: "new_identity_confirmation_required"
  };
}
function recomputeVehicleIdentity(asset) {
  const vin = stringAssertion(asset.assertions, "vehicle.vin");
  const year = numberAssertion(asset.assertions, "vehicle.year");
  const make = stringAssertion(asset.assertions, "vehicle.make");
  const model = stringAssertion(asset.assertions, "vehicle.model");
  const trim = stringAssertion(asset.assertions, "vehicle.trim");
  const input = { vin, modelYear: year, make, model, trim };
  const result2 = buildVehicleIdentity(input);
  const fingerprint = result2.exactFingerprint ?? result2.possibleMatchHint ?? "";
  const display = result2.normalizedVin && result2.maskedVin ? `${year ?? ""} ${make ?? ""} ${model ?? ""} ${trim ?? ""} (${result2.maskedVin})`.trim() : `${year ?? ""} ${make ?? ""} ${model ?? ""} ${trim ?? ""}`.trim();
  if (!fingerprint) {
    const fallback = display.toUpperCase().replace(/[^A-Z0-9]/g, "-") || "unidentified";
    return {
      identityFingerprint: `vehicle:unknown:${fallback}`,
      displayLabel: display || "Unidentified vehicle",
      matchClassification: "new_identity_confirmation_required"
    };
  }
  if (result2.strength === "exact") {
    return {
      identityFingerprint: fingerprint,
      displayLabel: display || fingerprint,
      matchClassification: "new"
    };
  }
  if (result2.strength === "possible") {
    return {
      identityFingerprint: fingerprint,
      displayLabel: display || fingerprint,
      matchClassification: "possible_existing_match"
    };
  }
  return {
    identityFingerprint: fingerprint,
    displayLabel: display || fingerprint,
    matchClassification: "new_identity_confirmation_required"
  };
}
function recomputeAssetIdentity(asset) {
  const recomputed = asset.assetType === "property" ? recomputePropertyIdentity(asset) : recomputeVehicleIdentity(asset);
  const validClassifications = [
    "new",
    "exact_existing_match",
    "possible_existing_match",
    "new_identity_confirmation_required"
  ];
  const preserveClassification = asset.matchClassification && validClassifications.includes(asset.matchClassification);
  return {
    ...asset,
    identityFingerprint: recomputed.identityFingerprint,
    displayLabel: recomputed.displayLabel || asset.displayLabel,
    matchClassification: preserveClassification ? asset.matchClassification : recomputed.matchClassification
  };
}
function recomputeDocumentIdentities(doc) {
  return {
    ...doc,
    assetAssertions: doc.assetAssertions.map(recomputeAssetIdentity)
  };
}
var LlmFirstDocumentAnalyzer = class {
  provider;
  loader;
  fallbackToDeterministic;
  constructor(options = {}) {
    this.provider = options.provider;
    this.loader = options.loader ?? null;
    this.fallbackToDeterministic = options.fallbackToDeterministic ?? true;
  }
  async analyzeSingleDocumentWithLlm(uploaded, extractedDoc, baseInput) {
    if (!this.provider) return null;
    const docInput = {
      ...baseInput,
      uploadedDocuments: [uploaded]
    };
    const { content, documentIdMap } = buildLlmAnalysisRequest(docInput, [extractedDoc]);
    const basePrompt = buildInsuranceAnalysisSystemPrompt();
    let validationFeedback = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const systemPrompt = validationFeedback ? `${basePrompt}

Your previous response failed validation. Correct these errors and respond only with the corrected JSON object. Errors:
${validationFeedback}` : basePrompt;
        const raw = await this.provider.extract({ content }, systemPrompt);
        const normalized = await normalizeLlmAnalysisResult(
          raw,
          docInput,
          [extractedDoc],
          this.provider,
          attempt,
          documentIdMap
        );
        return InsuranceDocumentAnalysisResultSchema.parse(normalized);
      } catch (error) {
        validationFeedback = validationFeedback || `${error instanceof Error ? error.message : String(error)}`.slice(0, 2e3);
        if (attempt === 2) return null;
      }
    }
    return null;
  }
  async analyzeWithLlm(input, extractedDocs) {
    if (!this.provider) return null;
    const existingByFingerprint = /* @__PURE__ */ new Map();
    for (const asset of input.existingAssets) {
      existingByFingerprint.set(asset.identityFingerprint, asset);
    }
    const allDocuments = [];
    const allDetected = [];
    const allConflicts = [];
    const allWarnings = [];
    const perDocTemporaryIdMap = /* @__PURE__ */ new Map();
    let totalAttempts = 0;
    for (let i = 0; i < extractedDocs.length; i++) {
      const extractedDoc = extractedDocs[i];
      const uploaded = input.uploadedDocuments[i];
      if (!uploaded) continue;
      const docResult = await this.analyzeSingleDocumentWithLlm(uploaded, extractedDoc, input);
      if (!docResult) {
        return null;
      }
      totalAttempts += docResult.attemptCount ?? 1;
      allDocuments.push(...docResult.documents);
      allWarnings.push(...docResult.warnings);
      for (const e of docResult.detectedEntities) {
        const existing = existingByFingerprint.get(e.canonicalFingerprint);
        if (existing && isExactFingerprint(e.canonicalFingerprint) && e.resolution.status !== "matches_existing") {
          e.resolution = {
            status: "matches_existing",
            matchedExistingEntityId: existing.id,
            confidence: 0.99,
            reasoning: "Exact identity fingerprint matches an existing household asset."
          };
        }
        const kept = allDetected.find((d) => d.canonicalFingerprint === e.canonicalFingerprint);
        if (kept) {
          perDocTemporaryIdMap.set(e.temporaryId, kept.temporaryId);
          mergeDetectedEntities(kept, e);
        } else {
          allDetected.push(e);
          perDocTemporaryIdMap.set(e.temporaryId, e.temporaryId);
        }
      }
      for (const c of docResult.unresolvedConflicts) {
        const mappedRef = perDocTemporaryIdMap.get(c.entityRef);
        allConflicts.push({ ...c, entityRef: mappedRef ?? c.entityRef });
      }
    }
    markPossiblePropertyDuplicates(allDetected);
    const documentMap = /* @__PURE__ */ new Map();
    for (const d of allDocuments) {
      documentMap.set(d.documentId, d);
    }
    const finalDocuments = extractedDocs.map((d) => {
      const analyzed = documentMap.get(d.documentId);
      return {
        documentId: d.documentId,
        fileDigest: d.fileDigest,
        classification: analyzed?.classification ?? "unknown",
        parserId: analyzed?.parserId ?? GENERIC_PARSER_ID,
        parserVersion: analyzed?.parserVersion ?? GENERIC_PARSER_VERSION,
        pageCount: d.pageCount,
        extractedEntityCount: countEntitiesForDocument(d.documentId, allDetected)
      };
    });
    return InsuranceDocumentAnalysisResultSchema.parse({
      analysisVersion: "1",
      modelProvider: this.provider.providerId,
      modelId: this.provider.modelId,
      documents: finalDocuments,
      detectedEntities: allDetected,
      unresolvedConflicts: allConflicts,
      warnings: allWarnings,
      rawResponse: null,
      attemptCount: totalAttempts,
      promptVersion: "1.0.0",
      outputSchemaVersion: "1.0.0"
    });
  }
  async analyze(input) {
    InsuranceDocumentAnalysisInputSchema.parse(input);
    if (!this.loader) {
      throw new Error("DocumentLoader is required to analyze uploaded documents");
    }
    const extractedDocs = [];
    const warnings = [];
    for (const uploaded of input.uploadedDocuments) {
      try {
        extractedDocs.push(await this.loader.load(uploaded));
      } catch (error) {
        warnings.push({
          message: `Could not load ${uploaded.filename}: ${error instanceof Error ? error.message : String(error)}`,
          documentId: uploaded.documentId
        });
      }
    }
    if (this.provider) {
      const llmResult = await this.analyzeWithLlm(input, extractedDocs);
      if (llmResult) {
        return llmResult;
      }
      if (!this.fallbackToDeterministic) {
        throw new Error("LLM analysis failed and deterministic fallback is disabled.");
      }
      warnings.push({
        message: "LLM analysis failed; falling back to deterministic extraction."
      });
    }
    const parsedDocuments = [];
    for (const extracted of extractedDocs) {
      try {
        parsedDocuments.push(await parseDocument(extracted));
      } catch (error) {
        warnings.push({
          message: `Deterministic extraction failed for ${extracted.documentId}: ${error instanceof Error ? error.message : String(error)}`,
          documentId: extracted.documentId
        });
      }
    }
    const existingByFingerprint = /* @__PURE__ */ new Map();
    for (const asset of input.existingAssets) {
      existingByFingerprint.set(asset.identityFingerprint, asset);
    }
    const pendingByFingerprint = /* @__PURE__ */ new Map();
    for (const candidate of input.pendingCandidates) {
      pendingByFingerprint.set(candidate.identityFingerprint, candidate);
    }
    const allExisting = [
      ...input.existingAssets.map((a) => ({
        assetType: a.assetType,
        identityFingerprint: a.identityFingerprint
      })),
      ...input.pendingCandidates.map((c) => ({
        assetType: c.assetType,
        identityFingerprint: c.identityFingerprint
      }))
    ];
    const recomputedDocuments = parsedDocuments.map(recomputeDocumentIdentities);
    const resolved = resolveParsedDocuments({
      householdAssets: allExisting,
      parsedDocuments: recomputedDocuments
    });
    const documents = resolved.documents.map(
      (doc) => buildAnalyzedDocument(doc)
    );
    const documentForCandidate = /* @__PURE__ */ new Map();
    for (const doc of resolved.documents) {
      for (const asset of doc.assetAssertions) {
        documentForCandidate.set(asset.identityFingerprint, doc);
      }
    }
    const detectedEntities = [];
    for (const candidate of resolved.candidates) {
      const doc = documentForCandidate.get(candidate.identityFingerprint) ?? resolved.documents[0];
      detectedEntities.push(
        await buildDetectedEntity(
          candidate,
          doc,
          doc?.documentId ?? candidate.assertions[0]?.documentId ?? "unknown",
          existingByFingerprint,
          pendingByFingerprint
        )
      );
    }
    const unresolvedConflicts = resolved.conflicts.map((c) => ({
      fieldPath: c.fieldPath,
      entityRef: c.fieldPath,
      assertionIds: c.assertionIds,
      explanation: c.reason,
      requiresHumanResolution: true
    }));
    const attempted = this.provider ? {
      attemptedModelProvider: this.provider.providerId,
      attemptedModelId: this.provider.modelId
    } : {};
    return InsuranceDocumentAnalysisResultSchema.parse({
      analysisVersion: "1",
      modelProvider: "deterministic",
      modelId: "pdfjs-fallback",
      ...attempted,
      fallbackReason: warnings.find((w) => w.message.includes("LLM analysis failed"))?.message,
      documents,
      detectedEntities,
      unresolvedConflicts,
      warnings,
      rawResponse: null,
      attemptCount: 1,
      promptVersion: "1.0.0",
      outputSchemaVersion: "1.0.0"
    });
  }
};
function buildCandidateContext(candidate) {
  return {
    id: candidate.id,
    entityType: candidate.assetType,
    displayLabel: candidate.identity ? buildDisplayLabel(candidate.identity, candidate.assetType) : candidate.displayLabel,
    identity: candidate.identity ? stripNullValues(candidate.identity) : {},
    currentPolicy: candidate.currentPolicy ? stripNullValues(candidate.currentPolicy) : void 0,
    exactIdentityFingerprint: candidate.candidateIdentity?.exactIdentityFingerprint ?? null,
    provisionalCandidateKey: candidate.candidateIdentity?.provisionalCandidateKey ?? candidate.identityFingerprint
  };
}
function stripNullValues(input) {
  const result2 = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== null && value !== void 0) {
      result2[key] = value;
    }
  }
  return result2;
}
var ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isValidDate(value) {
  if (value === null || value === void 0) return true;
  if (typeof value !== "string") return false;
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}
function isMonetaryField(fieldPath) {
  const normalized = fieldPath.toLowerCase().replace(/[^a-z]/g, "");
  return normalized.includes("cents") || normalized.includes("premium") || normalized.includes("limit") || normalized.includes("deductible");
}
function isValidMonetaryCents(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
function validateCurrentPolicy(policy) {
  if (policy.effectiveDate && !isValidDate(policy.effectiveDate)) {
    throw new Error(
      `currentPolicy.effectiveDate ${JSON.stringify(policy.effectiveDate)} is not a valid ISO date`
    );
  }
  if (policy.expiryDate && !isValidDate(policy.expiryDate)) {
    throw new Error(
      `currentPolicy.expiryDate ${JSON.stringify(policy.expiryDate)} is not a valid ISO date`
    );
  }
  if (policy.annualPremiumCents !== null && policy.annualPremiumCents !== void 0 && (!Number.isInteger(policy.annualPremiumCents) || policy.annualPremiumCents < 0)) {
    throw new Error(`currentPolicy.annualPremiumCents must be a non-negative integer`);
  }
  if (policy.effectiveDate && policy.expiryDate && new Date(policy.effectiveDate) > new Date(policy.expiryDate)) {
    throw new Error(`currentPolicy.effectiveDate must not be after expiryDate`);
  }
}
function validateEvidenceReference(ref, allowedDocumentIds, pageCountByDocumentId) {
  if (!allowedDocumentIds.has(ref.documentId)) {
    throw new Error(`evidence references unknown documentId ${ref.documentId}`);
  }
  if (ref.pageNumber !== void 0) {
    const pageCount = pageCountByDocumentId.get(ref.documentId);
    if (pageCount === void 0) {
      throw new Error(
        `evidence pageNumber ${ref.pageNumber} is not valid for unknown document ${ref.documentId}`
      );
    }
    if (pageCount === 0) return;
    if (ref.pageNumber < 1 || ref.pageNumber > pageCount) {
      throw new Error(
        `evidence pageNumber ${ref.pageNumber} is out of range for document ${ref.documentId} (pages ${pageCount})`
      );
    }
  }
}
function buildDisplayLabel(identity, entityType) {
  if (entityType === "vehicle") {
    const parts = [identity.year, identity.make, identity.model, identity.trim].filter(Boolean);
    return parts.length > 0 ? parts.join(" ") : void 0;
  }
  return identity.fullAddress ?? void 0;
}
function buildLlmAnalysisRequest(input, extractedDocs) {
  const parts = [];
  const documentIdMap = /* @__PURE__ */ new Map();
  const documentAliases = [];
  for (let i = 0; i < extractedDocs.length; i++) {
    const doc = extractedDocs[i];
    const alias = `doc-${i + 1}`;
    documentIdMap.set(doc.documentId, doc.documentId);
    documentIdMap.set(alias, doc.documentId);
    documentAliases.push(`${alias} = ${alias}`);
  }
  const candidateContexts = [
    ...input.existingAssets.map(buildCandidateContext),
    ...input.pendingCandidates.map(buildCandidateContext)
  ];
  parts.push({
    type: "text",
    text: `You are an insurance document analyst. Analyze the uploaded policy PDFs and produce a single JSON object conforming to the schema in the system prompt.

Jurisdiction: ${input.jurisdiction}

Document IDs (use ONLY these exact values for evidence documentId fields):
${documentAliases.join("\n")}${candidateContexts.length > 0 ? `

Existing and pending household candidates for comparison (use the exact "id" values for resolution.matchedExistingEntityId or resolution.matchedPendingCandidateId, and compare exactIdentityFingerprint/provisionalCandidateKey values before claiming a match):
${JSON.stringify(candidateContexts, null, 2)}` : ""}

The pages below are provided as extracted text. When page images are available they are included after the text for the same page.`
  });
  for (const doc of extractedDocs) {
    const alias = `doc-${extractedDocs.indexOf(doc) + 1}`;
    parts.push({
      type: "text",
      text: `
--- ${alias} (${doc.pageCount} pages) ---`
    });
    for (const page of doc.pages) {
      parts.push({
        type: "text",
        text: `
Page ${page.pageNumber}:
${page.text}`
      });
      if (page.image) {
        parts.push({
          type: "image_url",
          image_url: { url: `data:${page.image.mimeType};base64,${page.image.base64}` }
        });
      }
    }
  }
  return { content: parts, documentIdMap };
}
var INSURANCE_ANALYSIS_SYSTEM_PROMPT = `You are an insurance document analyst. Read the uploaded policy documents (provided as extracted document text) and produce a single JSON object that conforms to the schema below. Do not include markdown fences, commentary, or any keys not in the schema.

Core rules:
- Distinguish active coverage documents from informational notices, advertisements, and billing-only pages.
- A shared mailing address or correspondence address is NOT an insured property. Use only the address the policy actually covers.
- One customer may own multiple properties and vehicles. Do not merge assets unless they share the exact same VIN (vehicles) or the exact same full civic address (properties). A postal-code-only match is not enough.
- A policy number identifies a term, not an asset. The same asset may appear under different policy numbers across documents.
- For vehicles, VIN is the strongest identifier. For properties, the full civic address (street number, street name, city, province, postal code) is the strongest identifier.
- If a property address is redacted, partial, or only the postal code is visible, use resolution status "possible_match_requires_confirmation".
- If a document is a notice about future coverage, a discount notice, or promotional material, do not create an asset from it; instead add a warning.
- When a detected asset matches an existing asset in existingAssets or pendingCandidates, set resolution.status to "matches_existing" or "matches_pending_candidate" and include the matched id.
- Monetary values must be integer cents (e.g. $438,000 -> 43800000). Dates should be ISO strings (YYYY-MM-DD) when known.
- For document-implied mandate suggestions, apply these semantic rules:
  * limit -> { rule: "minimum", amountCents: <current value in cents> }
  * deductible -> { rule: "maximum", amountCents: <current value in cents> }
  * coverage form/type -> { rule: "match_current_or_better", value: "<current value>" }
  * optional coverage that is included -> { rule: "required" } (omit value)
  * optional coverage that is explicitly not included or not applicable -> { rule: "any", reason: "..." }
  * unknown or not-provided coverage -> omit the mandate suggestion entirely; never convert it to zero, false, absent, optional, empty, or "any"
- Mandate suggestions are evidenced, non-authoritative suggestions. Never claim to create or persist an asset, policy, mandate, database ID, consent, or authorization record.
- Every known or conflicting value must include an evidence array entry with documentId and evidenceSummary. Unknown values do not need evidence.

Expected output JSON schema:
{
  "detectedEntities": [
    {
      "temporaryId": "unique stable opaque id for this candidate (string)",
      "entityType": "property" | "vehicle",
      "displayLabel": "human readable label e.g. '2006 Mazda Mazda5 GT' or '123 Main St NW Calgary AB T3A 0C2'",
      "identity": {
        "fullAddress": "string or null",
        "city": "string or null",
        "province": "string or null",
        "postalCode": "string or null",
        "occupancy": "principal_residence" | "rental" | "other" | "unknown" | null,
        "vin": "string or null",
        "year": integer or null,
        "make": "string or null",
        "model": "string or null",
        "trim": "string or null",
        "vehicleUse": "string or null"
      },
      "resolution": {
        "status": "new" | "matches_existing" | "matches_pending_candidate" | "possible_match_requires_confirmation",
        "matchedExistingEntityId": "string or null/omitted",
        "matchedPendingCandidateId": "string or null/omitted",
        "confidence": number between 0 and 1,
        "reasoning": "string"
      },
      "currentPolicy": {
        "insurer": "string or null",
        "policyNumber": "string or null",
        "effectiveDate": "YYYY-MM-DD or null",
        "expiryDate": "YYYY-MM-DD or null",
        "annualPremiumCents": integer or null
      },
      "currentCoverage": {
        "<field>": {
          "status": "known" | "unknown" | "not_included" | "not_applicable" | "conflicting",
          "value": any (number in cents for money, boolean for presence, string for form/type, null when unknown),
          "confidence": number between 0 and 1,
          "evidence": [{ "documentId": "...", "pageNumber": number, "quotedLabel": "...", "evidenceSummary": "..." }],
          "alternatives": [{ "value": any, "evidence": [{ "documentId": "...", "pageNumber": number, "evidenceSummary": "..." }], "explanation": "string or omitted" }] (required with at least two entries when status is "conflicting"),
          "explanation": "string or omitted"
        }
      },
      "mandateSuggestions": {
        "<field>": { "rule": "minimum" | "maximum" | "match_current_or_better" | "required" | "any", "amountCents": integer, "value": "string", "reason": "string" } - use only the keys that match the rule
      },
      "evidence": [{ "documentId": "...", "pageNumber": number, "quotedLabel": "...", "evidenceSummary": "..." }],
      "requiredConfirmations": ["string"]
    }
  ],
  "unresolvedConflicts": [
    {
      "fieldPath": "string e.g. property.dwellingLimitCents",
      "entityRef": "temporaryId of the entity",
      "assertionIds": ["string"],
      "explanation": "string",
      "requiresHumanResolution": true
    }
  ],
  "warnings": [
    {
      "message": "string",
      "documentId": "string or omitted"
    }
  ]
}

Return only the JSON object.`;
function buildInsuranceAnalysisSystemPrompt() {
  return INSURANCE_ANALYSIS_SYSTEM_PROMPT;
}
function countEntitiesForDocument(documentId, entities) {
  return entities.filter((entity) => {
    if (entity.evidence.some((e) => e.documentId === documentId)) return true;
    return Object.values(entity.currentCoverage).some(
      (cv) => cv.evidence?.some((e) => e.documentId === documentId)
    );
  }).length;
}
function mergeDetectedEntities(target, source) {
  target.evidence.push(...source.evidence);
  for (const [fieldPath, value] of Object.entries(source.currentCoverage)) {
    const existing = target.currentCoverage[fieldPath];
    if (!existing || (value.confidence ?? 0) > (existing.confidence ?? 0)) {
      target.currentCoverage[fieldPath] = value;
    }
  }
  target.mandateSuggestions = { ...target.mandateSuggestions, ...source.mandateSuggestions };
  const required = /* @__PURE__ */ new Set([...target.requiredConfirmations, ...source.requiredConfirmations]);
  target.requiredConfirmations = Array.from(required);
}
function markPossiblePropertyDuplicates(entities) {
  const propertyGroups = /* @__PURE__ */ new Map();
  for (const e of entities) {
    if (e.entityType !== "property") continue;
    if (isExactFingerprint(e.canonicalFingerprint)) continue;
    const postal = e.identity.postalCode?.toUpperCase().replace(/\s+/g, "");
    if (!postal) continue;
    const group = propertyGroups.get(postal) ?? [];
    group.push(e);
    propertyGroups.set(postal, group);
  }
  for (const group of propertyGroups.values()) {
    if (group.length <= 1) continue;
    for (const e of group) {
      e.resolution = {
        status: "possible_match_requires_confirmation",
        confidence: 0.5,
        reasoning: `Another pending property candidate shares postal code ${e.identity.postalCode}. Confirm whether they are the same property.`
      };
      if (!e.requiredConfirmations.includes(e.resolution.reasoning)) {
        e.requiredConfirmations.push(e.resolution.reasoning);
      }
    }
  }
}
function documentClassification(documentId, entities) {
  const types = new Set(
    entities.filter((e) => {
      if (e.evidence.some((ev) => ev.documentId === documentId)) return true;
      return Object.values(e.currentCoverage).some(
        (cv) => cv.evidence?.some((ev) => ev.documentId === documentId)
      );
    }).map((e) => e.entityType)
  );
  if (types.has("vehicle") && types.has("property")) return "unknown";
  if (types.has("vehicle")) return "auto_policy_renewal";
  if (types.has("property")) return "home_policy_renewal";
  return "unknown";
}
function normalizeMandateRule(raw, fieldPath) {
  if (!raw || typeof raw !== "object") {
    throw new Error(`mandateSuggestions.${fieldPath} is not an object`);
  }
  const typed = raw;
  const rule = typed.rule;
  if (rule === "minimum" || rule === "maximum") {
    const minAmount = rule === "minimum" ? 1 : 0;
    if (typeof typed.amountCents !== "number" || typed.amountCents < minAmount || !Number.isInteger(typed.amountCents)) {
      throw new Error(
        `mandateSuggestions.${fieldPath}.${rule} requires an integer amountCents >= ${minAmount}`
      );
    }
    return { rule, amountCents: typed.amountCents };
  }
  if (rule === "match_current_or_better") {
    if (typeof typed.value !== "string" || typed.value.trim().length === 0) {
      throw new Error(`mandateSuggestions.${fieldPath}.${rule} requires a non-empty value`);
    }
    return { rule, value: typed.value.trim() };
  }
  if (rule === "required") {
    return { rule: "required" };
  }
  if (rule === "any") {
    return {
      rule: "any",
      reason: typeof typed.reason === "string" ? typed.reason : void 0
    };
  }
  throw new Error(`mandateSuggestions.${fieldPath} has unknown rule ${String(rule)}`);
}
function normalizeCurrentValue(raw, fieldPath, documentIdMap, allowedDocumentIds, pageCountByDocumentId) {
  if (!raw || typeof raw !== "object") {
    throw new Error(`currentCoverage.${fieldPath} is not an object`);
  }
  const typed = raw;
  const status = String(typed.status);
  if (status !== "known" && status !== "unknown" && status !== "not_included" && status !== "not_applicable" && status !== "conflicting") {
    throw new Error(`currentCoverage.${fieldPath} has invalid status ${status}`);
  }
  if (typeof typed.confidence !== "number" || typed.confidence < 0 || typed.confidence > 1) {
    throw new Error(`currentCoverage.${fieldPath} requires a confidence number between 0 and 1`);
  }
  const value = Object.prototype.hasOwnProperty.call(typed, "value") ? typed.value : null;
  const explanation = typeof typed.explanation === "string" && typed.explanation.length > 0 ? typed.explanation : void 0;
  if (status === "known" && value !== null && value !== void 0) {
    if (isMonetaryField(fieldPath) && !isValidMonetaryCents(value)) {
      throw new Error(
        `currentCoverage.${fieldPath} value ${JSON.stringify(value)} is not a valid non-negative integer cent amount`
      );
    }
    if (typeof value === "string" && ISO_DATE_RE.test(value) && !isValidDate(value)) {
      throw new Error(
        `currentCoverage.${fieldPath} value ${JSON.stringify(value)} is not a valid date`
      );
    }
  }
  let evidence;
  if (Array.isArray(typed.evidence) && typed.evidence.length > 0) {
    evidence = typed.evidence.map((item, index) => {
      try {
        const ref = EvidenceReferenceSchema.parse(item);
        if (ref.documentId && documentIdMap.has(ref.documentId)) {
          const mapped = { ...ref, documentId: documentIdMap.get(ref.documentId) };
          validateEvidenceReference(mapped, allowedDocumentIds, pageCountByDocumentId);
          return mapped;
        }
        validateEvidenceReference(ref, allowedDocumentIds, pageCountByDocumentId);
        return ref;
      } catch (err) {
        throw new Error(
          `currentCoverage.${fieldPath}.evidence[${index}] is invalid: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    });
  }
  if ((status === "known" || status === "conflicting") && (!evidence || evidence.length === 0)) {
    const fallbackDocId = [...allowedDocumentIds][0];
    if (fallbackDocId) {
      evidence = [
        { documentId: fallbackDocId, evidenceSummary: "Extracted from uploaded policy document" }
      ];
    } else {
      throw new Error(`currentCoverage.${fieldPath} status ${status} requires evidence`);
    }
  }
  let alternatives;
  if (Array.isArray(typed.alternatives)) {
    alternatives = typed.alternatives.map((alternative, alternativeIndex) => {
      if (!alternative || typeof alternative !== "object") {
        throw new Error(
          `currentCoverage.${fieldPath}.alternatives[${alternativeIndex}] is not an object`
        );
      }
      const candidate = alternative;
      const alternativeValue = candidate.value;
      if (isMonetaryField(fieldPath) && !isValidMonetaryCents(alternativeValue)) {
        throw new Error(
          `currentCoverage.${fieldPath}.alternatives[${alternativeIndex}] is not a valid cent amount`
        );
      }
      const alternativeEvidence = z.array(EvidenceReferenceSchema).min(1).parse(candidate.evidence).map((ref) => {
        const mapped = documentIdMap.has(ref.documentId) ? { ...ref, documentId: documentIdMap.get(ref.documentId) } : ref;
        validateEvidenceReference(mapped, allowedDocumentIds, pageCountByDocumentId);
        return mapped;
      });
      return {
        value: alternativeValue,
        evidence: alternativeEvidence,
        explanation: typeof candidate.explanation === "string" ? candidate.explanation : void 0
      };
    });
  }
  if (status === "conflicting" && (!alternatives || alternatives.length < 2)) {
    throw new Error(`currentCoverage.${fieldPath} conflicting status requires two alternatives`);
  }
  return ExtractedCurrentValueSchema.parse({
    status,
    value,
    confidence: typed.confidence,
    evidence,
    alternatives,
    explanation
  });
}
async function hashProvisionalKey(input) {
  const keys = Object.keys(input).sort();
  const ordered = {};
  for (const key of keys) {
    const value = input[key];
    ordered[key] = value === void 0 ? null : value;
  }
  const text = new TextEncoder().encode(JSON.stringify(ordered));
  const digest = await crypto.subtle.digest("SHA-256", text);
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `provisional:${hex.slice(0, 32)}`;
}
function isRedactedAddress(input) {
  if (!input) return true;
  const normalized = input.toUpperCase().replace(/\s+/g, " ");
  if (normalized.trim().length === 0) return true;
  const markers = ["REDACTED", "WITHHELD", "NOT PROVIDED", "UNKNOWN", "XXXX", "****", "\u2022\u2022\u2022\u2022"];
  return markers.some((m) => normalized.includes(m));
}
async function buildCandidateIdentity(identity, entityType) {
  if (entityType === "vehicle") {
    const result3 = buildVehicleIdentity({
      vin: identity.vin ?? void 0,
      modelYear: identity.year ?? void 0,
      make: identity.make ?? void 0,
      model: identity.model ?? void 0,
      trim: identity.trim ?? void 0
    });
    if (result3.exactFingerprint) {
      return {
        exactIdentityFingerprint: result3.exactFingerprint,
        provisionalCandidateKey: result3.exactFingerprint,
        identityStrength: "exact"
      };
    }
    const key2 = await hashProvisionalKey({
      entityType,
      vin: result3.normalizedVin?.toUpperCase().replace(/\s+/g, "") ?? null,
      year: identity.year,
      make: identity.make?.toLowerCase().trim() ?? null,
      model: identity.model?.toLowerCase().trim() ?? null,
      trim: identity.trim?.toLowerCase().trim() ?? null
    });
    return {
      exactIdentityFingerprint: null,
      provisionalCandidateKey: key2,
      identityStrength: identity.vin && !result3.normalizedVin ? "redacted" : identity.year && identity.make && identity.model ? "partial" : "unknown"
    };
  }
  const redacted = identity.fullAddress ? isRedactedAddress(identity.fullAddress) : true;
  const result2 = buildPropertyIdentity({
    addressLine1: identity.fullAddress ?? void 0,
    city: identity.city ?? void 0,
    province: identity.province ?? void 0,
    postalCode: identity.postalCode ?? void 0,
    occupancy: identity.occupancy === "other" ? void 0 : identity.occupancy,
    isRedacted: redacted
  });
  if (result2.exactFingerprint) {
    return {
      exactIdentityFingerprint: result2.exactFingerprint,
      provisionalCandidateKey: result2.exactFingerprint,
      identityStrength: "exact"
    };
  }
  const keyInput = {
    entityType,
    city: result2.normalizedCity?.toLowerCase() ?? null,
    province: result2.normalizedProvince?.toLowerCase() ?? null,
    postalCode: result2.normalizedPostalCode?.replace(/\s+/g, "") ?? null
  };
  const key = await hashProvisionalKey(keyInput);
  const strength = redacted ? "redacted" : identity.city && identity.province ? "partial" : identity.postalCode ? "partial" : "unknown";
  return {
    exactIdentityFingerprint: null,
    provisionalCandidateKey: key,
    identityStrength: strength
  };
}
function isExactFingerprint(fingerprint) {
  return fingerprint.startsWith("vehicle:vin:") && fingerprint.length > "vehicle:vin:".length || fingerprint.startsWith("property:") && fingerprint.includes("|");
}
function resolveCanonicalFingerprint(candidateFingerprint, _entityType, resolution, matchedExisting, matchedPending) {
  const target = matchedExisting ?? matchedPending;
  if (!target || resolution.status !== "matches_existing" && resolution.status !== "matches_pending_candidate") {
    return candidateFingerprint;
  }
  const targetExact = isExactFingerprint(target.identityFingerprint);
  const candidateExact = isExactFingerprint(candidateFingerprint);
  if (targetExact && candidateExact && target.identityFingerprint === candidateFingerprint) {
    return target.identityFingerprint;
  }
  resolution.status = "possible_match_requires_confirmation";
  resolution.confidence = Math.min(resolution.confidence, 0.5);
  resolution.reasoning = `Identity match requires confirmation: ${resolution.reasoning} (the match is not an exact VIN or full-address match).`;
  return candidateFingerprint;
}
function generateOpaqueId() {
  const cryptoGlobal = crypto;
  if (typeof cryptoGlobal.randomUUID === "function") {
    return cryptoGlobal.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
async function normalizeLlmAnalysisResult(raw, input, extractedDocs, provider, attemptCount, documentAliasMap) {
  if (!raw || typeof raw !== "object") {
    throw new Error("LLM response is not a JSON object");
  }
  const typed = raw;
  if (!Array.isArray(typed.detectedEntities)) {
    throw new Error('LLM response missing required "detectedEntities" array');
  }
  const unresolvedConflicts = Array.isArray(typed.unresolvedConflicts) ? typed.unresolvedConflicts : [];
  const warnings = Array.isArray(typed.warnings) ? typed.warnings : [];
  const documentIdMap = new Map(documentAliasMap);
  for (const doc of input.uploadedDocuments) {
    documentIdMap.set(doc.documentId, doc.documentId);
  }
  for (const doc of input.priorDocumentSummaries) {
    documentIdMap.set(doc.documentId, doc.documentId);
  }
  const existingById = /* @__PURE__ */ new Map();
  for (const asset of input.existingAssets) {
    existingById.set(asset.id, asset);
  }
  const pendingById = /* @__PURE__ */ new Map();
  for (const candidate of input.pendingCandidates) {
    pendingById.set(candidate.id, candidate);
  }
  const existingByFingerprint = /* @__PURE__ */ new Map();
  for (const asset of input.existingAssets) {
    existingByFingerprint.set(asset.identityFingerprint, asset);
  }
  const pendingByFingerprint = /* @__PURE__ */ new Map();
  for (const candidate of input.pendingCandidates) {
    pendingByFingerprint.set(candidate.identityFingerprint, candidate);
  }
  const rawEntityIdMap = /* @__PURE__ */ new Map();
  for (let index = 0; index < typed.detectedEntities.length; index++) {
    const entity = typed.detectedEntities[index];
    if (!entity || typeof entity !== "object") {
      throw new Error(`detectedEntities[${index}] is not an object`);
    }
    const e = entity;
    if (typeof e.temporaryId !== "string" || e.temporaryId.trim().length === 0) {
      throw new Error(`detectedEntities[${index}] is missing a temporaryId`);
    }
    const rawId = e.temporaryId.trim();
    if (rawEntityIdMap.has(rawId)) {
      throw new Error(`detectedEntities[${index}] has duplicate temporaryId ${rawId}`);
    }
    rawEntityIdMap.set(rawId, generateOpaqueId());
  }
  const allowedDocumentIds = new Set(documentIdMap.values());
  const pageCountByDocumentId = /* @__PURE__ */ new Map();
  for (const doc of extractedDocs) {
    pageCountByDocumentId.set(doc.documentId, doc.pageCount);
  }
  for (const summary of input.priorDocumentSummaries) {
    if (summary.fileDigest && !pageCountByDocumentId.has(summary.documentId)) {
      pageCountByDocumentId.set(summary.documentId, 0);
    }
  }
  const enrichedEntities = await Promise.all(
    typed.detectedEntities.map(async (entity, index) => {
      const e = entity;
      const entityType = e.entityType === "property" || e.entityType === "vehicle" ? e.entityType : null;
      if (!entityType) {
        throw new Error(`detectedEntities[${index}] is missing a valid entityType`);
      }
      const rawTemporaryId = e.temporaryId;
      const temporaryId = rawEntityIdMap.get(rawTemporaryId) ?? generateOpaqueId();
      const displayLabel = typeof e.displayLabel === "string" && e.displayLabel.trim().length > 0 ? e.displayLabel.trim() : temporaryId;
      const identity = DetectedEntityIdentitySchema.parse(e.identity);
      const currentPolicy = CurrentPolicySchema.parse(e.currentPolicy);
      const candidateIdentity = await buildCandidateIdentity(identity, entityType);
      const candidateFingerprint = candidateIdentity.exactIdentityFingerprint ?? candidateIdentity.provisionalCandidateKey;
      const matchedExisting = existingByFingerprint.get(candidateFingerprint);
      const matchedPending = pendingByFingerprint.get(candidateFingerprint);
      const initialResolution = matchedExisting ? {
        status: "matches_existing",
        matchedExistingEntityId: matchedExisting.id,
        confidence: 0.99,
        reasoning: "Exact identity fingerprint matches an existing household asset."
      } : matchedPending ? {
        status: "matches_pending_candidate",
        matchedPendingCandidateId: matchedPending.id,
        confidence: 0.99,
        reasoning: "Exact identity fingerprint matches a pending candidate."
      } : {
        status: candidateIdentity.exactIdentityFingerprint ? "new" : "possible_match_requires_confirmation",
        confidence: candidateIdentity.exactIdentityFingerprint ? 0.95 : 0.5,
        reasoning: candidateIdentity.exactIdentityFingerprint ? "No existing or pending asset matches the normalized identity fingerprint." : "Identity is partial or redacted and requires customer confirmation before it can be matched."
      };
      const resolution = EntityResolutionSchema.parse(initialResolution);
      const canonicalFingerprint = resolveCanonicalFingerprint(
        candidateFingerprint,
        entityType,
        resolution,
        matchedExisting,
        matchedPending
      );
      const rawCoverage = e.currentCoverage ?? {};
      const currentCoverage = {};
      for (const [fieldPath, rawValue] of Object.entries(rawCoverage)) {
        currentCoverage[fieldPath] = normalizeCurrentValue(
          rawValue,
          fieldPath,
          documentIdMap,
          allowedDocumentIds,
          pageCountByDocumentId
        );
      }
      const rawMandates = e.mandateSuggestions ?? {};
      const mandateSuggestions = {};
      for (const [fieldPath, rawValue] of Object.entries(rawMandates)) {
        const coverage = currentCoverage[fieldPath];
        if (!coverage) {
          throw new Error(
            `mandateSuggestions.${fieldPath} has no corresponding document coverage assertion`
          );
        }
        if (coverage.status === "unknown") {
          throw new Error(
            `mandateSuggestions.${fieldPath} must be omitted when the document value is unknown`
          );
        }
        mandateSuggestions[fieldPath] = normalizeMandateRule(rawValue, fieldPath);
      }
      const evidence = Array.isArray(e.evidence) ? e.evidence.map((item, idx) => {
        try {
          const ref = EvidenceReferenceSchema.parse(item);
          const mappedId = ref.documentId ? documentIdMap.get(ref.documentId) : void 0;
          const mapped = mappedId ? { ...ref, documentId: mappedId } : ref;
          validateEvidenceReference(mapped, allowedDocumentIds, pageCountByDocumentId);
          return mapped;
        } catch (err) {
          throw new Error(
            `detectedEntities[${index}].evidence[${idx}] is invalid: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }).filter(
        (ref) => typeof ref.evidenceSummary === "string" && ref.evidenceSummary.length > 0
      ) : [];
      validateCurrentPolicy(currentPolicy);
      const requiredConfirmations = Array.isArray(e.requiredConfirmations) ? e.requiredConfirmations.filter((x) => typeof x === "string" && x.length > 0) : [];
      if (candidateIdentity.identityStrength === "redacted") {
        requiredConfirmations.push(
          "Confirm the insured civic address or VIN because the extracted identity is redacted."
        );
      } else if (candidateIdentity.identityStrength === "partial") {
        requiredConfirmations.push(
          "Confirm the insured address or VIN because the extracted identity is partial."
        );
      }
      if (resolution.status === "possible_match_requires_confirmation") {
        requiredConfirmations.push(resolution.reasoning);
      }
      return {
        temporaryId,
        canonicalFingerprint,
        candidateIdentity,
        entityType,
        displayLabel,
        identity,
        resolution,
        currentPolicy,
        currentCoverage,
        mandateSuggestions,
        evidence,
        requiredConfirmations
      };
    })
  );
  const normalizedConflicts = unresolvedConflicts.map((conflict, index) => {
    try {
      const parsed = DetectedConflictSchema.parse(conflict);
      const mappedId = rawEntityIdMap.get(parsed.entityRef);
      if (mappedId) {
        return { ...parsed, entityRef: mappedId };
      }
      return parsed;
    } catch (err) {
      throw new Error(
        `unresolvedConflicts[${index}] is invalid: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });
  const normalizedWarnings = warnings.map((warning, index) => {
    try {
      return AnalysisWarningSchema.parse(warning);
    } catch (err) {
      throw new Error(
        `warnings[${index}] is invalid: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });
  const documents = extractedDocs.map((doc) => ({
    documentId: doc.documentId,
    fileDigest: doc.fileDigest,
    classification: documentClassification(doc.documentId, enrichedEntities),
    parserId: GENERIC_PARSER_ID,
    parserVersion: GENERIC_PARSER_VERSION,
    pageCount: doc.pageCount,
    extractedEntityCount: countEntitiesForDocument(doc.documentId, enrichedEntities)
  }));
  return {
    analysisVersion: "1",
    modelProvider: provider.providerId,
    modelId: provider.modelId,
    documents,
    detectedEntities: enrichedEntities,
    unresolvedConflicts: normalizedConflicts,
    warnings: normalizedWarnings,
    rawResponse: raw,
    attemptCount,
    promptVersion: "1.0.0",
    outputSchemaVersion: "1.0.0"
  };
}
function createLlmFirstAnalyzer(options) {
  return new LlmFirstDocumentAnalyzer(options);
}
async function sha256HexBytes(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
var NativeDocumentAnalyzer = class {
  provider;
  bytesLoader;
  authorization;
  fileLifecycleStore;
  analysisRequestId;
  preTransmissionCheck;
  lifecycleRecords = /* @__PURE__ */ new Map();
  constructor(options) {
    this.provider = options.provider;
    this.bytesLoader = options.bytesLoader;
    this.authorization = options.authorization;
    this.fileLifecycleStore = options.fileLifecycleStore;
    this.analysisRequestId = options.analysisRequestId;
    this.preTransmissionCheck = options.preTransmissionCheck;
  }
  async analyze(input) {
    InsuranceDocumentAnalysisInputSchema.parse(input);
    if (!this.authorization || this.authorization.authorizationResult !== "authorized") {
      throw new Error("Document processing not authorized: consent required or withdrawn");
    }
    const originalInputs = [];
    const fileDigestByDocumentId = /* @__PURE__ */ new Map();
    for (const uploaded of input.uploadedDocuments) {
      const original = await this.bytesLoader.load(uploaded);
      const digest = await sha256HexBytes(original.bytes);
      originalInputs.push(original);
      fileDigestByDocumentId.set(original.documentId, digest);
    }
    const resolved = await this.provider.resolveModel();
    if (this.provider.assertBatchFits) {
      await this.provider.assertBatchFits(originalInputs);
    }
    let normalizedResult;
    const allHandles = [];
    try {
      const capabilities = await Promise.all(
        originalInputs.map((o) => this.provider.resolveInputMode(o))
      );
      for (let i = 0; i < originalInputs.length; i++) {
        const original = originalInputs[i];
        const capability = capabilities[i];
        if (!capability.supported || capability.mode === "unsupported") {
          throw new Error(
            `Unsupported file type for native document analysis: ${original.filename} (${capability.reason})`
          );
        }
      }
      await this.preTransmissionCheck?.();
      const settled = await Promise.allSettled(
        originalInputs.map((original) => this.uploadAndRecord(original))
      );
      const uploadResults = [];
      const readyHandles = [];
      const uploadFailures = [];
      for (let i = 0; i < settled.length; i++) {
        const result2 = settled[i];
        if (result2.status === "rejected") {
          uploadFailures.push(String(result2.reason));
          continue;
        }
        const uploadResult = result2.value;
        uploadResults[i] = uploadResult;
        if (uploadResult.handle) {
          allHandles.push(uploadResult.handle);
        }
        if (uploadResult.status !== "ready" || !uploadResult.handle) {
          uploadFailures.push(uploadResult.errorCategory ?? "upload_failed");
          continue;
        }
        readyHandles.push(uploadResult.handle);
      }
      if (uploadFailures.length > 0) {
        throw new Error(`Document upload failed: ${uploadFailures.join("; ")}`);
      }
      const syntheticExtractedDocs = originalInputs.map((original, i) => ({
        documentId: original.documentId,
        fileDigest: fileDigestByDocumentId.get(original.documentId) ?? "unknown",
        pageCount: uploadResults[i]?.handle?.mode === "native_image_reference" ? 1 : uploadResults[i]?.handle?.mode === "native_video_reference" ? 0 : 0,
        pages: []
      }));
      const documentAliasMap = /* @__PURE__ */ new Map();
      for (const doc of input.uploadedDocuments) {
        documentAliasMap.set(doc.documentId, doc.documentId);
      }
      for (const summary of input.priorDocumentSummaries) {
        documentAliasMap.set(summary.documentId, summary.documentId);
      }
      const candidateContexts = [
        ...input.existingAssets.map(buildCandidateContext),
        ...input.pendingCandidates.map(buildCandidateContext)
      ];
      const baseUserPrompt = buildNativeAnalysisUserPrompt({
        jurisdiction: input.jurisdiction,
        documentIds: input.uploadedDocuments.map((d) => d.documentId),
        candidateContexts
      });
      let validationFeedback = "";
      let lastError;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const userPrompt = validationFeedback ? `${baseUserPrompt}

Your previous response failed validation. Correct these errors and respond only with the corrected JSON object. Errors:
${validationFeedback}` : baseUserPrompt;
        let rawResult;
        try {
          rawResult = await this.provider.analyze({
            model: resolved.modelId,
            systemPrompt: buildInsuranceAnalysisSystemPrompt(),
            userPrompt,
            files: readyHandles,
            responseFormat: { type: "json_object" }
          });
        } catch (error) {
          lastError = error;
          const message = error instanceof Error ? error.message : String(error);
          if (attempt === 1 && /not valid JSON/i.test(message)) {
            validationFeedback = "Return one syntactically valid JSON object matching the schema.";
            continue;
          }
          throw error;
        }
        try {
          normalizedResult = await normalizeLlmAnalysisResult(
            rawResult,
            input,
            syntheticExtractedDocs,
            { providerId: this.provider.providerId, modelId: resolved.modelId },
            attempt,
            documentAliasMap
          );
          break;
        } catch (err) {
          lastError = err;
          validationFeedback = err instanceof Error ? err.message.slice(0, 2e3) : String(err).slice(0, 2e3);
          if (attempt === 2) break;
        }
      }
      if (!normalizedResult) {
        throw lastError ?? new Error("Document analysis failed after validation repair attempt");
      }
    } catch (err) {
      await this.deleteAll(allHandles);
      throw err;
    }
    const deletionResults = await this.deleteAll(allHandles);
    normalizedResult.modelProvider = GENERIC_PARSER_ID;
    normalizedResult.modelId = GENERIC_PARSER_VERSION;
    normalizedResult.providerMetadata = {
      providerId: this.provider.providerId,
      modelId: resolved.modelId,
      providerFiles: allHandles.map((h) => ({
        documentId: h.documentId,
        mode: h.mode,
        bytes: h.bytes
      })),
      deletionResults
    };
    return normalizedResult;
  }
  async uploadAndRecord(original) {
    await this.preTransmissionCheck?.();
    if (this.fileLifecycleStore && this.authorization) {
      const record = await this.fileLifecycleStore.recordUpload({
        authorizationId: this.authorization.id,
        analysisRequestId: this.analysisRequestId,
        policyDocumentId: original.documentId,
        providerFileId: "pending",
        uploadStatus: "started"
      });
      this.lifecycleRecords.set(original.documentId, record.id);
    }
    let createdHandle;
    const recordHandle = async (handle) => {
      createdHandle = handle;
      if (this.fileLifecycleStore && this.authorization) {
        const recordId = this.lifecycleRecords.get(original.documentId);
        if (recordId) {
          await this.fileLifecycleStore.markUploadCompleted(recordId, {
            providerFileId: handle.providerFileId,
            uploadStatus: "completed"
          });
        }
      }
    };
    try {
      const result2 = await this.provider.uploadOriginalFile(original, {
        onHandleCreated: recordHandle
      });
      if (this.fileLifecycleStore && this.authorization) {
        const recordId = this.lifecycleRecords.get(original.documentId);
        if (recordId) {
          const patch = result2.handle ? {
            providerFileId: result2.handle.providerFileId,
            uploadStatus: "completed",
            processingStatus: result2.status === "ready" ? "ready" : result2.status
          } : { uploadStatus: result2.status === "rejected" ? "rejected" : "failed" };
          await this.fileLifecycleStore.markUploadCompleted(recordId, patch);
        }
      }
      return result2;
    } catch (err) {
      if (this.fileLifecycleStore && this.authorization) {
        const recordId = this.lifecycleRecords.get(original.documentId);
        if (recordId) {
          const patch = createdHandle ? {
            providerFileId: createdHandle.providerFileId,
            uploadStatus: "completed",
            processingStatus: "failed"
          } : { uploadStatus: "failed" };
          try {
            await this.fileLifecycleStore.markUploadCompleted(recordId, patch);
          } catch {
          }
        }
      }
      if (createdHandle) {
        return {
          status: "failed",
          handle: createdHandle,
          errorCategory: err instanceof Error ? err.message : "upload_failed"
        };
      }
      throw err;
    }
  }
  async deleteAll(handles) {
    const results = [];
    const unhandled = [];
    const MAX_IMMEDIATE_ATTEMPTS = 3;
    for (const handle of handles) {
      let deletion;
      try {
        deletion = await this.provider.deleteFile(handle);
      } catch (error) {
        deletion = {
          deleted: false,
          attempts: 1,
          failureCategory: classifyDeletionError(error)
        };
      }
      let attempts = deletion.attempts ?? 1;
      while (!deletion.deleted && attempts < MAX_IMMEDIATE_ATTEMPTS) {
        await delay(Math.min(1e3 * Math.pow(2, attempts - 1), 5e3));
        try {
          deletion = await this.provider.deleteFile(handle);
          attempts += 1;
        } catch (retryErr) {
          attempts += 1;
          deletion = {
            deleted: false,
            attempts,
            failureCategory: classifyDeletionError(retryErr)
          };
        }
      }
      results.push(deletion);
      if (this.fileLifecycleStore && this.authorization) {
        const recordId = this.lifecycleRecords.get(handle.documentId);
        if (recordId) {
          let recordErr;
          try {
            await this.fileLifecycleStore.recordDeletionAttempt(recordId, deletion);
          } catch (err) {
            recordErr = err;
          }
          if (!deletion.deleted || recordErr) {
            const nextAttemptAt = /* @__PURE__ */ new Date();
            nextAttemptAt.setMinutes(nextAttemptAt.getMinutes() + 5 * attempts);
            const failureCategory = (deletion.failureCategory ?? "deletion_failed") + (recordErr ? ";ledger_update_failed" : "");
            try {
              await this.fileLifecycleStore.queueCleanup(
                recordId,
                failureCategory,
                nextAttemptAt.toISOString(),
                handle.providerFileId
              );
            } catch {
              try {
                await this.fileLifecycleStore.recordEmergencyCleanup(
                  handle.providerFileId,
                  handle.documentId,
                  failureCategory
                );
              } catch {
                unhandled.push({
                  providerFileId: handle.providerFileId,
                  documentId: handle.documentId
                });
              }
            }
          }
        }
      }
    }
    if (unhandled.length > 0) {
      throw new Error(
        `Cleanup persistence failed for ${unhandled.length} provider file(s). Support reference: ${generateSupportReference()}.`
      );
    }
    return results;
  }
};
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function classifyDeletionError(error) {
  return error instanceof Error ? error.message : "delete_failed";
}
function buildNativeAnalysisUserPrompt(args) {
  const lines = [
    `Jurisdiction: ${args.jurisdiction}`,
    "",
    "Analyze the uploaded insurance documents and produce a single JSON object matching the schema in the system prompt.",
    "",
    `Use ONLY these document IDs for evidence: ${args.documentIds.join(", ")}`
  ];
  if (args.candidateContexts.length > 0) {
    lines.push(
      "",
      "Existing and pending household candidates for comparison (use the exact 'id' values for resolution.matchedExistingEntityId or resolution.matchedPendingCandidateId, and compare exactIdentityFingerprint/provisionalCandidateKey values before claiming a match):",
      JSON.stringify(args.candidateContexts, null, 2)
    );
  }
  lines.push(
    "",
    "The documents are provided as native inputs. Do not invent values not supported by the documents."
  );
  return lines.join("\n");
}
function createNativeDocumentAnalyzer(options) {
  return new NativeDocumentAnalyzer(options);
}
var createKimiK3Analyzer = createNativeDocumentAnalyzer;

// src/providers/privacy-preparation.ts
var ConfigAndConsentPrivacyPreparation = class {
  config;
  consent;
  constructor(config, consent) {
    this.config = config;
    this.consent = consent;
  }
  async assertAuthorized() {
    if (!this.config.externalDocumentProcessingEnabled) {
      throw new Error(
        "Document processing is not enabled. External document processing must be enabled by the operator."
      );
    }
    if (!this.config.rawExternalDocumentProcessingApproved) {
      throw new Error(
        "Raw external document processing is not approved. Operator approval is required before transmitting original files."
      );
    }
    if (!this.config.privacyNoticeVersion || !this.config.processorContractVersion) {
      throw new Error(
        "Privacy notice and processor contract versions must be configured before document processing."
      );
    }
    if (!this.consent) {
      throw new Error(
        "Document processing consent is missing. The customer must provide explicit consent before analysis."
      );
    }
    if (this.consent.withdrawnAt) {
      throw new Error("Document processing consent has been withdrawn.");
    }
    if (!this.consent.foreignProcessingAcknowledged) {
      throw new Error(
        "Foreign processing acknowledgement is required before documents can be analyzed externally."
      );
    }
    if (!this.consent.automatedProcessingAcknowledged) {
      throw new Error(
        "Automated processing acknowledgement is required before documents can be analyzed."
      );
    }
    if (!this.consent.rawProcessingApproved) {
      throw new Error("Raw document processing is not approved for this customer consent.");
    }
    if (this.consent.privacyNoticeVersion !== this.config.privacyNoticeVersion) {
      throw new Error("The recorded privacy notice version is out of date.");
    }
    if (this.consent.processorContractVersion !== this.config.processorContractVersion) {
      throw new Error("The recorded processor contract version is out of date.");
    }
    if (this.config.cleanupReadinessCheck) {
      const ready = await this.config.cleanupReadinessCheck();
      if (!ready) {
        throw new Error(
          "Cleanup worker readiness has not been verified. External processing is blocked."
        );
      }
    }
  }
  async prepare(input) {
    await this.assertAuthorized();
    const privacyAssessmentId = `privacy-${this.consent.householdId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return {
      mode: "raw_original",
      file: input,
      privacyAssessmentId
    };
  }
  async authorize(actorProfileId, authorizationStore) {
    await this.assertAuthorized();
    return authorizationStore.createAuthorization({
      householdId: this.consent.householdId,
      actorProfileId,
      consentId: this.consent.id,
      purpose: this.consent.purpose,
      privacyNoticeVersion: this.consent.privacyNoticeVersion,
      processorContractVersion: this.consent.processorContractVersion,
      foreignProcessingAcknowledged: this.consent.foreignProcessingAcknowledged,
      automatedProcessingAcknowledged: this.consent.automatedProcessingAcknowledged,
      rawProcessingApproved: this.consent.rawProcessingApproved,
      externalProcessingEnabled: this.config.externalDocumentProcessingEnabled,
      authorizationResult: "authorized"
    });
  }
};
function privacyPreparationConfigFromEnv(getEnv2) {
  return {
    externalDocumentProcessingEnabled: getEnv2("EXTERNAL_DOCUMENT_PROCESSING_ENABLED") === "true",
    rawExternalDocumentProcessingApproved: getEnv2("RAW_EXTERNAL_DOCUMENT_PROCESSING_APPROVED") === "true",
    privacyNoticeVersion: getEnv2("PRIVACY_NOTICE_VERSION") ?? "",
    processorContractVersion: getEnv2("PROCESSOR_CONTRACT_VERSION") ?? ""
  };
}

// src/providers/kimi-k3.ts
var InvalidProviderJsonError = class extends Error {
  constructor() {
    super("Document analysis response was not valid JSON");
    this.name = "InvalidProviderJsonError";
  }
};
var KimiK3Provider = class {
  providerId = "kimi-k3";
  baseUrl;
  apiKey;
  requestedModel;
  resolvedModel = null;
  timeoutMs;
  fetchImpl;
  constructor(options) {
    this.baseUrl = (options.baseUrl ?? "https://api.moonshot.ai/v1").replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.requestedModel = options.requestedModel;
    this.timeoutMs = options.timeoutMs ?? 12e5;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }
  fetch(...args) {
    return this.fetchImpl(...args);
  }
  async resolveModel() {
    if (this.resolvedModel) return this.resolvedModel;
    if (this.requestedModel) {
      if (!isIntendedK3Model(this.requestedModel)) {
        throw new Error("Configured document model does not match the intended K3 model");
      }
      const model = await this.fetchModel(this.requestedModel);
      if (model && isIntendedK3Model(model.id)) {
        this.resolvedModel = this.toResolvedModel(model);
        return this.resolvedModel;
      }
      throw new Error("Document model unavailable");
    }
    const models = await this.listModels();
    const k3 = models.find((m) => m.id.toLowerCase().includes("kimi-k3"));
    if (!k3) {
      throw new Error("Document model unavailable");
    }
    this.resolvedModel = this.toResolvedModel(k3);
    return this.resolvedModel;
  }
  toResolvedModel(model) {
    return {
      modelId: model.id,
      supportsImageInput: !!model.supports_image_in,
      supportsVideoInput: !!model.supports_video_in,
      supportsGenericFileInput: true,
      supportedReferenceSchemes: ["ms://"],
      providerMetadata: {
        owned_by: model.owned_by,
        context_length: model.context_length,
        supports_reasoning: model.supports_reasoning,
        supports_dynamic_tools: model.supports_dynamic_tools,
        reasoning_efforts: model.reasoning_efforts,
        supports_thinking_type: model.supports_thinking_type
      }
    };
  }
  async listModels() {
    const response = await this.fetch(`${this.baseUrl}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.apiKey}` }
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Document model list failed: ${response.status} ${text.slice(0, 200)}`);
    }
    const body = await response.json();
    return body.data ?? [];
  }
  async fetchModel(modelId) {
    const models = await this.listModels();
    return models.find((m) => m.id === modelId);
  }
  async resolveInputMode(input) {
    const model = await this.resolveModel();
    const mime = (input.mimeType || "").toLowerCase().trim();
    if (mime.startsWith("image/")) {
      return { mimeType: input.mimeType, mode: "provider_extracted_text", supported: true };
    }
    if (mime.startsWith("video/") && model.supportsVideoInput) {
      return { mimeType: input.mimeType, mode: "native_video_reference", supported: true };
    }
    if (mime.startsWith("video/")) {
      return {
        mimeType: input.mimeType,
        mode: "unsupported",
        supported: false,
        reason: "Video input is not supported by the resolved document model"
      };
    }
    if (mime === "application/pdf") {
      return {
        mimeType: input.mimeType,
        mode: "provider_extracted_text",
        supported: true
      };
    }
    return {
      mimeType: input.mimeType,
      mode: "unsupported",
      supported: false,
      reason: "Native file reference is not supported for this file type"
    };
  }
  async assertBatchFits(inputs) {
    const model = await this.resolveModel();
    const contextLength = Number(model.providerMetadata.context_length ?? 0);
    if (!Number.isFinite(contextLength) || contextLength <= 0) {
      throw new Error("Document model context capacity is unavailable");
    }
    const estimatedInputTokens = inputs.reduce((total, input) => {
      if (input.mimeType.toLowerCase() === "application/pdf") {
        return total + Math.ceil(input.bytes.length / 4);
      }
      if (input.mimeType.toLowerCase().startsWith("image/")) return total + 4096;
      return total + Math.ceil(input.bytes.length / 4);
    }, 8e3);
    const outputReserve = Math.min(32e3, Math.floor(contextLength * 0.25));
    if (estimatedInputTokens + outputReserve > Math.floor(contextLength * 0.9)) {
      throw new Error("Document batch exceeds the resolved model context capacity");
    }
  }
  async uploadOriginalFile(input, callbacks) {
    const capability = await this.resolveInputMode(input);
    if (!capability.supported) {
      return {
        status: "rejected",
        errorCategory: capability.reason ?? "unsupported_file_type"
      };
    }
    const purpose = capability.mode === "provider_extracted_text" ? "file-extract" : capability.mode === "native_image_reference" ? "image" : capability.mode === "native_video_reference" ? "video" : "file";
    const form = new FormData();
    form.append("purpose", purpose);
    form.append("file", new Blob([input.bytes], { type: input.mimeType }), input.filename);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(`${this.baseUrl}/files`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: controller.signal
      });
      if (!response.ok) {
        return {
          status: "failed",
          errorCategory: `upload_failed_${response.status}`
        };
      }
      const file = await response.json();
      const referenceScheme = (await this.resolveModel()).supportedReferenceSchemes[0] ?? "ms://";
      let handle = {
        providerFileId: file.id,
        documentId: input.documentId,
        filename: file.filename ?? input.filename,
        mimeType: input.mimeType,
        bytes: file.bytes ?? input.bytes.length,
        mode: capability.mode,
        reference: `${referenceScheme}${file.id}`,
        status: file.status,
        statusDetails: file.status_details,
        providerMetadata: {
          file_type: file.file_type,
          created_at: file.created_at,
          purpose: file.purpose
        }
      };
      if (callbacks?.onHandleCreated) {
        await callbacks.onHandleCreated(handle);
      }
      const finalStatus = await this.pollFileStatus(file.id);
      if (finalStatus.status !== "ok" && finalStatus.status !== "processed") {
        return {
          status: finalStatus.status,
          handle,
          errorCategory: finalStatus.errorCategory ?? "upload_processing_failed"
        };
      }
      if (capability.mode === "provider_extracted_text") {
        handle = {
          ...handle,
          transientExtractedContent: await this.fetchExtractedContent(file.id)
        };
      }
      return { status: "ready", handle };
    } finally {
      clearTimeout(timeout);
    }
  }
  async fetchExtractedContent(fileId) {
    const response = await this.fetch(`${this.baseUrl}/files/${fileId}/content`, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.apiKey}` }
    });
    if (!response.ok) {
      throw new Error(`Document file extraction failed: ${response.status}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    let content;
    if (contentType.includes("application/json")) {
      const body = await response.json();
      const value = body.content ?? body.text;
      if (typeof value !== "string") {
        throw new Error("Document file extraction returned no content");
      }
      content = value;
    } else {
      content = await response.text();
    }
    if (!content.trim()) throw new Error("Document file extraction returned empty content");
    if (content.length > 8e6) {
      throw new Error("Extracted document content exceeds the analysis limit");
    }
    return content;
  }
  async pollFileStatus(fileId) {
    const deadline = Date.now() + 6e4;
    while (Date.now() < deadline) {
      const response = await this.fetch(`${this.baseUrl}/files/${fileId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.apiKey}` }
      });
      if (!response.ok) {
        return { status: "failed", errorCategory: `status_poll_${response.status}` };
      }
      const file = await response.json();
      if (file.status === "ok" || file.status === "processed") {
        return { status: file.status };
      }
      if (file.status === "error") {
        return { status: "failed", errorCategory: file.status_details ?? "upload_error" };
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return { status: "timed_out", errorCategory: "status_poll_timeout" };
  }
  async analyze(input) {
    const userParts = [{ type: "text", text: input.userPrompt }];
    for (const file of input.files) {
      if (file.mode === "native_image_reference" && file.reference) {
        userParts.push({ type: "image_url", image_url: { url: file.reference } });
      } else if (file.mode === "native_video_reference" && file.reference) {
        userParts.push({ type: "video_url", video_url: { url: file.reference } });
      } else if (file.mode === "native_file_reference" && file.reference) {
        throw new Error("Native file reference is not supported by the resolved document model");
      } else if (file.mode === "provider_extracted_text") {
        if (!file.transientExtractedContent) {
          throw new Error("Provider-extracted document content is unavailable");
        }
        userParts.push({
          type: "text",
          text: [
            `<policy-document id="${file.documentId}">`,
            file.transientExtractedContent,
            "</policy-document>"
          ].join("\n")
        });
      }
    }
    const messages = [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: userParts }
    ];
    const body = {
      model: input.model,
      messages,
      response_format: input.responseFormat ?? { type: "json_object" },
      max_completion_tokens: 12e3,
      reasoning_effort: "low"
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `Document analysis request failed: ${response.status} ${text.slice(0, 200)}`
        );
      }
      const completion = await response.json();
      const content = completion.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error("Document analysis response did not contain text content");
      }
      try {
        return JSON.parse(stripMarkdownJsonFence2(content));
      } catch {
        throw new InvalidProviderJsonError();
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  async deleteFile(handle) {
    const maxAttempts = 3;
    let attempts = 0;
    while (attempts < maxAttempts) {
      attempts += 1;
      try {
        const response = await this.fetch(`${this.baseUrl}/files/${handle.providerFileId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${this.apiKey}` }
        });
        if (response.ok) {
          return { deleted: true, attempts, statusCode: response.status };
        }
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          return {
            deleted: false,
            attempts,
            statusCode: response.status,
            failureCategory: `deletion_client_error_${response.status}`
          };
        }
        if (attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 1e3 * attempts));
        }
      } catch (err) {
        if (attempts >= maxAttempts) {
          return {
            deleted: false,
            attempts,
            failureCategory: err instanceof Error ? err.message : "network_error"
          };
        }
      }
    }
    return { deleted: false, attempts, failureCategory: "deletion_failed_after_retries" };
  }
};
function isIntendedK3Model(modelId) {
  return /(^|[-_/])kimi[-_/]?k3($|[-_/])/i.test(modelId) || modelId.toLowerCase().includes("kimi-k3");
}
function stripMarkdownJsonFence2(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    const lines = trimmed.split("\n");
    if (lines.length > 1 && lines[0].trim().toLowerCase().startsWith("```json")) {
      return lines.slice(1, -1).join("\n").trim();
    }
    if (lines.length > 1 && lines[0].trim().startsWith("```")) {
      return lines.slice(1, -1).join("\n").trim();
    }
  }
  return trimmed;
}

// src/providers/openai-gpt-5-mini.ts
var CONTEXT_LENGTH = 4e5;
function isGpt5MiniModel(modelId) {
  return /gpt[-_]?5[-_]?mini/i.test(modelId);
}
function bytesToBase64(bytes) {
  const chunkSize = 65536;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}
var OpenAiGpt5MiniProvider = class {
  providerId = "openai";
  baseUrl;
  apiKey;
  requestedModel;
  resolvedModel = null;
  timeoutMs;
  fetchImpl;
  constructor(options) {
    this.baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.requestedModel = options.requestedModel;
    this.timeoutMs = options.timeoutMs ?? 12e5;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }
  fetch(...args) {
    return this.fetchImpl(...args);
  }
  async resolveModel() {
    if (this.resolvedModel) return this.resolvedModel;
    const modelId = this.requestedModel && isGpt5MiniModel(this.requestedModel) ? this.requestedModel : "gpt-5-mini";
    this.resolvedModel = {
      modelId,
      supportsImageInput: true,
      supportsVideoInput: false,
      supportsGenericFileInput: true,
      supportedReferenceSchemes: ["openai://"],
      providerMetadata: {
        context_length: CONTEXT_LENGTH,
        owned_by: "openai"
      }
    };
    return this.resolvedModel;
  }
  async resolveInputMode(input) {
    const mime = (input.mimeType || "").toLowerCase().trim();
    if (mime === "application/pdf" || mime.startsWith("image/")) {
      return { mimeType: input.mimeType, mode: "provider_extracted_text", supported: true };
    }
    return {
      mimeType: input.mimeType,
      mode: "unsupported",
      supported: false,
      reason: "GPT-5 mini only supports PDF and image inputs in this integration"
    };
  }
  async assertBatchFits(inputs) {
    const estimatedInputTokens = inputs.reduce((total, input) => {
      if (input.mimeType.toLowerCase() === "application/pdf") {
        return total + Math.ceil(input.bytes.length / 4);
      }
      if (input.mimeType.toLowerCase().startsWith("image/")) return total + 4096;
      return total + Math.ceil(input.bytes.length / 4);
    }, 8e3);
    const outputReserve = 12e3;
    if (estimatedInputTokens + outputReserve > Math.floor(CONTEXT_LENGTH * 0.9)) {
      throw new Error("Document batch exceeds the resolved model context capacity");
    }
  }
  async uploadOriginalFile(input, callbacks) {
    const capability = await this.resolveInputMode(input);
    if (!capability.supported) {
      return { status: "rejected", errorCategory: capability.reason ?? "unsupported_file_type" };
    }
    const providerFileId = crypto.randomUUID();
    const base64 = bytesToBase64(input.bytes);
    const handle = {
      providerFileId,
      documentId: input.documentId,
      filename: input.filename,
      mimeType: input.mimeType,
      bytes: input.bytes.length,
      mode: capability.mode,
      reference: `openai://${providerFileId}`,
      status: "ready",
      providerMetadata: {
        base64,
        originalMimeType: input.mimeType
      }
    };
    if (callbacks?.onHandleCreated) {
      await callbacks.onHandleCreated(handle);
    }
    return { status: "ready", handle };
  }
  async analyze(input) {
    const model = input.model || (await this.resolveModel()).modelId;
    const contents = [];
    for (const file of input.files) {
      const base64 = typeof file.transientExtractedContent === "string" ? file.transientExtractedContent : typeof file.providerMetadata?.base64 === "string" ? file.providerMetadata.base64 : void 0;
      if (!base64) {
        throw new Error("OpenAI provider missing base64 data for file");
      }
      contents.push({
        type: "input_file",
        filename: file.filename,
        file_data: `data:${file.mimeType};base64,${base64}`,
        detail: "auto"
      });
    }
    const body = {
      model,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: input.userPrompt }, ...contents]
        }
      ],
      instructions: input.systemPrompt,
      response_format: input.responseFormat ?? { type: "json_object" },
      max_output_tokens: 12e3
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(`${this.baseUrl}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!response.ok) {
        const text2 = await response.text().catch(() => "");
        throw new Error(
          `Document analysis request failed: ${response.status} ${text2.slice(0, 200)}`
        );
      }
      const completion = await response.json();
      if (completion.error?.message) {
        throw new Error(`Document analysis failed: ${completion.error.message}`);
      }
      const text = completion.output?.[0]?.content?.[0]?.text;
      if (typeof text !== "string") {
        throw new Error("Document analysis response did not contain text content");
      }
      return JSON.parse(stripMarkdownJsonFence3(text));
    } finally {
      clearTimeout(timeout);
    }
  }
  async deleteFile(handle) {
    void handle;
    return { deleted: true, attempts: 1 };
  }
};
function stripMarkdownJsonFence3(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    const lines = trimmed.split("\n");
    if (lines.length > 1 && lines[0].trim().toLowerCase().startsWith("```json")) {
      return lines.slice(1, -1).join("\n").trim();
    }
    if (lines.length > 1 && lines[0].trim().startsWith("```")) {
      return lines.slice(1, -1).join("\n").trim();
    }
  }
  return trimmed;
}

// src/providers/gemini-2.5-flash-lite.ts
var CONTEXT_LENGTH2 = 1048576;
function getEnv(name) {
  try {
    const deno = globalThis.Deno;
    if (deno?.env?.get) {
      return deno.env.get(name);
    }
  } catch {
  }
  return void 0;
}
var PRIMARY_MODEL = getEnv("DOCUMENT_MODEL_PRIMARY") ?? "gemini-2.5-flash";
var ROUTINE_FALLBACK_MODEL = getEnv("DOCUMENT_MODEL_ROUTINE_FALLBACK") ?? "gemini-3.1-flash-lite";
var QUALITY_ESCALATION_MODEL = getEnv("DOCUMENT_MODEL_QUALITY_ESCALATION") ?? "gemini-3.5-flash";
var CROSS_PROVIDER_FALLBACK_MODEL = getEnv("DOCUMENT_MODEL_PROVIDER_FALLBACK") ?? "gpt-5-mini";
function isGeminiModel(modelId) {
  return modelId.toLowerCase().includes("gemini") || modelId.toLowerCase().includes("flash");
}
function classifyGeminiError(err) {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  const availability = [
    "503",
    "429",
    "404",
    "not found",
    "no longer available",
    "high demand",
    "temporarily unavailable",
    "overloaded",
    "unavailable",
    "fetch failed",
    "network",
    "connection",
    "timeout",
    "timed out",
    "abort",
    "socket",
    "econnrefused",
    "dns",
    "wall_clock",
    "deadline exceeded"
  ];
  if (availability.some((token) => lower.includes(token))) return "availability";
  const quality = [
    "json",
    "unexpected token",
    "not valid",
    "invalid",
    "schema",
    "missing required",
    "requires",
    "is not a",
    "conflict",
    "ambiguous",
    "low confidence",
    "cannot parse",
    "failed to parse"
  ];
  if (quality.some((token) => lower.includes(token))) return "quality";
  return "fatal";
}
function bytesToBase642(bytes) {
  const chunkSize = 65536;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}
function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
function parseMoneyToCents(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Number.isInteger(value) ? value : Math.round(value * 100);
  }
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[^0-9.]/g, "");
  if (!normalized) return null;
  const [dollars, cents = "00"] = normalized.split(".");
  const whole = parseInt(dollars || "0", 10);
  const fraction = parseInt((cents + "00").slice(0, 2), 10);
  return whole * 100 + fraction;
}
function parseDate(value) {
  if (typeof value === "string") {
    const iso = value.replace(/\//g, "-").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }
  if (typeof value === "object" && value !== null) {
    const obj = value;
    if (typeof obj.start_date === "string") return parseDate(obj.start_date);
  }
  return null;
}
function extractCurrentValue(raw) {
  if (raw === null || raw === void 0) return null;
  if (typeof raw === "object") {
    const typed = raw;
    if (typeof typed.status === "string") {
      return {
        status: typed.status,
        value: Object.prototype.hasOwnProperty.call(typed, "value") ? typed.value : null,
        confidence: typeof typed.confidence === "number" ? typed.confidence : 0.85
      };
    }
  }
  return { status: "known", value: raw, confidence: 0.85 };
}
function transformGeminiResponse(raw, documentIds) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Gemini response is not a JSON object");
  }
  const typed = raw;
  const firstDocId = documentIds[0] ?? "doc-1";
  const allowedDocIds = new Set(documentIds);
  const transformEntity = (entity, index) => {
    if (!entity || typeof entity !== "object") {
      throw new Error(`detectedEntities[${index}] is not an object`);
    }
    const e = entity;
    const identity = typeof e.identity === "object" && e.identity !== null ? e.identity : {};
    const currentPolicyRaw = typeof e.currentPolicy === "object" && e.currentPolicy !== null ? e.currentPolicy : {};
    const annualPremiumCents = parseMoneyToCents(
      currentPolicyRaw.annualPremiumCents ?? currentPolicyRaw.premium_cents ?? currentPolicyRaw.total_annual_amount
    );
    const currentPolicy = {
      insurer: currentPolicyRaw.insurer ?? null,
      policyNumber: currentPolicyRaw.policyNumber ?? currentPolicyRaw.policy_number ?? null,
      effectiveDate: parseDate(
        currentPolicyRaw.effectiveDate ?? currentPolicyRaw.effective_date ?? currentPolicyRaw.term_of_coverage
      ),
      expiryDate: parseDate(
        currentPolicyRaw.expiryDate ?? currentPolicyRaw.expiry_date ?? currentPolicyRaw.renewal_term
      ),
      annualPremiumCents
    };
    const rawCoverage = typeof e.currentCoverage === "object" && e.currentCoverage !== null ? e.currentCoverage : typeof e.coverage === "object" && e.coverage !== null ? e.coverage : {};
    const currentCoverage = {};
    for (const [fieldPath, rawValue] of Object.entries(rawCoverage)) {
      const parsed = extractCurrentValue(rawValue);
      if (parsed) currentCoverage[fieldPath] = parsed;
    }
    const sanitizeEvidence = (item) => {
      if (!item || typeof item !== "object") return null;
      const ref = item;
      const docId = typeof ref.documentId === "string" && allowedDocIds.has(ref.documentId) ? ref.documentId : firstDocId;
      const pageNumber = typeof ref.pageNumber === "number" ? ref.pageNumber : 1;
      const quotedLabel = typeof ref.quotedLabel === "string" && ref.quotedLabel.length > 0 ? ref.quotedLabel : "Extracted from document";
      const evidenceSummary = typeof ref.evidenceSummary === "string" && ref.evidenceSummary.length > 0 ? ref.evidenceSummary : "Document analysis";
      return { documentId: docId, pageNumber, quotedLabel, evidenceSummary };
    };
    const evidenceArray = Array.isArray(e.evidence) ? e.evidence : [];
    let evidence = evidenceArray.map(sanitizeEvidence).filter((x) => x !== null);
    if (evidence.length === 0) {
      evidence = [
        {
          documentId: firstDocId,
          pageNumber: 1,
          quotedLabel: "Document analysis",
          evidenceSummary: "Extracted from uploaded PDF"
        }
      ];
    }
    const rawResolution = typeof e.resolution === "object" && e.resolution !== null ? e.resolution : {};
    const resolution = {
      status: [
        "new",
        "matches_existing",
        "matches_pending_candidate",
        "possible_match_requires_confirmation"
      ].includes(String(rawResolution.status)) ? String(rawResolution.status) : "new",
      confidence: typeof rawResolution.confidence === "number" ? rawResolution.confidence : 0.85,
      reasoning: typeof rawResolution.reasoning === "string" && rawResolution.reasoning.length > 0 ? rawResolution.reasoning : "Extracted from uploaded documents"
    };
    const displayLabel = typeof e.displayLabel === "string" && e.displayLabel.length > 0 ? e.displayLabel : identity.year && identity.make && identity.model ? `${identity.year} ${identity.make} ${identity.model}` : String(identity.fullAddress ?? identity.postalCode ?? `entity-${index}`);
    const temporaryId = typeof e.temporaryId === "string" && e.temporaryId.length > 0 ? e.temporaryId : crypto.randomUUID();
    return {
      temporaryId,
      entityType: e.entityType === "vehicle" || e.entityType === "property" ? e.entityType : "property",
      displayLabel,
      identity: {
        fullAddress: identity.fullAddress ?? null,
        city: identity.city ?? null,
        province: identity.province ?? null,
        postalCode: identity.postalCode ?? null,
        occupancy: ["principal_residence", "rental", "other", "unknown"].includes(
          String(identity.occupancy)
        ) ? identity.occupancy : null,
        vin: identity.vin ?? null,
        year: typeof identity.year === "number" ? identity.year : null,
        make: identity.make ?? null,
        model: identity.model ?? null,
        trim: identity.trim ?? null,
        vehicleUse: identity.vehicleUse ?? null
      },
      resolution,
      currentPolicy,
      currentCoverage,
      mandateSuggestions: typeof e.mandateSuggestions === "object" && e.mandateSuggestions !== null ? e.mandateSuggestions : {},
      evidence,
      requiredConfirmations: Array.isArray(e.requiredConfirmations) ? e.requiredConfirmations.filter((x) => typeof x === "string" && x.length > 0) : []
    };
  };
  const detectedEntities = Array.isArray(typed.detectedEntities) ? typed.detectedEntities.map(transformEntity) : [];
  const unresolvedConflicts = Array.isArray(typed.unresolvedConflicts) ? typed.unresolvedConflicts.filter((x) => typeof x === "object" && x !== null) : [];
  const warnings = Array.isArray(typed.warnings) ? typed.warnings.filter((x) => typeof x === "object" && x !== null) : [];
  return {
    ...typed,
    detectedEntities,
    unresolvedConflicts,
    warnings
  };
}
var GeminiFlashLiteProvider = class {
  providerId = "gemini";
  baseUrl;
  apiKey;
  requestedModel;
  resolvedModel = null;
  timeoutMs;
  fetchImpl;
  constructor(options) {
    this.baseUrl = (options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(
      /\/+$/,
      ""
    );
    this.apiKey = options.apiKey;
    this.requestedModel = options.requestedModel;
    this.timeoutMs = options.timeoutMs ?? 12e5;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }
  fetch(...args) {
    return this.fetchImpl(...args);
  }
  async resolveModel() {
    if (this.resolvedModel) return this.resolvedModel;
    const modelId = this.requestedModel && isGeminiModel(this.requestedModel) ? this.requestedModel : PRIMARY_MODEL;
    this.resolvedModel = {
      modelId,
      supportsImageInput: true,
      supportsVideoInput: false,
      supportsGenericFileInput: true,
      supportedReferenceSchemes: ["gemini://"],
      providerMetadata: {
        context_length: CONTEXT_LENGTH2,
        owned_by: "google"
      }
    };
    return this.resolvedModel;
  }
  async resolveInputMode(input) {
    const mime = (input.mimeType || "").toLowerCase().trim();
    if (mime === "application/pdf" || mime.startsWith("image/")) {
      return { mimeType: input.mimeType, mode: "provider_extracted_text", supported: true };
    }
    return {
      mimeType: input.mimeType,
      mode: "unsupported",
      supported: false,
      reason: "Gemini only supports PDF and image inputs in this integration"
    };
  }
  async assertBatchFits(inputs) {
    const estimatedInputTokens = inputs.reduce((total, input) => {
      if (input.mimeType.toLowerCase() === "application/pdf") {
        return total + Math.ceil(input.bytes.length / 4);
      }
      if (input.mimeType.toLowerCase().startsWith("image/")) return total + 4096;
      return total + Math.ceil(input.bytes.length / 4);
    }, 8e3);
    const outputReserve = 12e3;
    if (estimatedInputTokens + outputReserve > Math.floor(CONTEXT_LENGTH2 * 0.9)) {
      throw new Error("Document batch exceeds the resolved model context capacity");
    }
  }
  async uploadOriginalFile(input) {
    const capability = await this.resolveInputMode(input);
    if (!capability.supported) {
      return { status: "rejected", errorCategory: capability.reason ?? "unsupported_file_type" };
    }
    const base64 = bytesToBase642(input.bytes);
    const providerFileId = crypto.randomUUID();
    const handle = {
      providerFileId,
      documentId: input.documentId,
      filename: input.filename,
      mimeType: input.mimeType,
      bytes: input.bytes.length,
      mode: capability.mode,
      reference: `gemini://${providerFileId}`,
      status: "ready",
      providerMetadata: {
        base64,
        originalMimeType: input.mimeType
      },
      transientExtractedContent: base64
    };
    return { status: "ready", handle };
  }
  async analyze(input) {
    await this.resolveModel();
    const primaryModel = input.model || this.resolvedModel?.modelId || PRIMARY_MODEL;
    const maxAttempts = Math.max(1, Number(getEnv("DOCUMENT_MODEL_MAX_ATTEMPTS") ?? 3));
    const maxProviderSwitches = Math.max(
      0,
      Number(getEnv("DOCUMENT_MODEL_MAX_PROVIDER_SWITCHES") ?? 1)
    );
    const humanReviewOnFailure = getEnv("DOCUMENT_MODEL_HUMAN_REVIEW_ON_FAILURE") !== "false";
    const orderedModels = [primaryModel];
    const tried = /* @__PURE__ */ new Set([primaryModel]);
    let lastError;
    let primaryRetryDone = false;
    let providerSwitches = 0;
    for (let i = 0; i < orderedModels.length && i < maxAttempts; i++) {
      const modelId = orderedModels[i];
      try {
        if (!isGeminiModel(modelId)) {
          if (providerSwitches >= maxProviderSwitches) {
            throw new Error(`Provider switch limit reached for ${modelId}`);
          }
          providerSwitches++;
          return await this.tryCrossProviderAnalyze(input, modelId);
        }
        return await this.tryAnalyzeWithModel(input, modelId);
      } catch (err) {
        lastError = err;
        const category = classifyGeminiError(err);
        if (category === "fatal") {
          throw err;
        }
        if (modelId === primaryModel && category === "availability" && !primaryRetryDone) {
          primaryRetryDone = true;
          const jitter = 500 + Math.random() * 1500;
          await new Promise((resolve) => setTimeout(resolve, jitter));
          orderedModels.splice(i + 1, 0, primaryModel);
          continue;
        }
        if (category === "availability" && !tried.has(ROUTINE_FALLBACK_MODEL)) {
          orderedModels.push(ROUTINE_FALLBACK_MODEL);
          tried.add(ROUTINE_FALLBACK_MODEL);
        }
        if ((category === "quality" || category === "availability") && !tried.has(QUALITY_ESCALATION_MODEL)) {
          orderedModels.push(QUALITY_ESCALATION_MODEL);
          tried.add(QUALITY_ESCALATION_MODEL);
        }
        if (category === "availability" && !isGeminiModel(CROSS_PROVIDER_FALLBACK_MODEL) && !tried.has(CROSS_PROVIDER_FALLBACK_MODEL)) {
          if (providerSwitches < maxProviderSwitches) {
            orderedModels.push(CROSS_PROVIDER_FALLBACK_MODEL);
            tried.add(CROSS_PROVIDER_FALLBACK_MODEL);
          }
        }
      }
    }
    if (humanReviewOnFailure) {
      throw new Error(
        `Document analysis requires human review after ${maxAttempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`
      );
    }
    throw lastError ?? new Error("Document analysis failed on all models");
  }
  async tryCrossProviderAnalyze(input, modelId) {
    const openAiApiKey = getEnv("OPENAI_API_KEY");
    if (!openAiApiKey) {
      throw new Error(
        `Cross-provider fallback to ${modelId} is not configured: OPENAI_API_KEY missing`
      );
    }
    const openAi = new OpenAiGpt5MiniProvider({
      apiKey: openAiApiKey,
      baseUrl: getEnv("OPENAI_API_BASE_URL") ?? void 0,
      requestedModel: modelId,
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl
    });
    const originalInputs = input.files.map((handle) => {
      const base64 = typeof handle.transientExtractedContent === "string" ? handle.transientExtractedContent : typeof handle.providerMetadata?.base64 === "string" ? handle.providerMetadata.base64 : "";
      return {
        documentId: handle.documentId,
        filename: handle.filename,
        mimeType: handle.mimeType,
        bytes: base64ToBytes(base64)
      };
    });
    const openAiHandles = [];
    try {
      for (const original of originalInputs) {
        const upload = await openAi.uploadOriginalFile(original);
        if (!upload.handle) {
          throw new Error(`OpenAI upload failed: ${upload.errorCategory ?? "unknown"}`);
        }
        openAiHandles.push(upload.handle);
      }
      return await openAi.analyze({
        model: modelId,
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        files: openAiHandles,
        responseFormat: { type: "json_object" }
      });
    } finally {
      for (const handle of openAiHandles) {
        await openAi.deleteFile({ providerFileId: handle.providerFileId }).catch(() => {
        });
      }
    }
  }
  async tryAnalyzeWithModel(input, modelId) {
    const parts = [
      { text: input.userPrompt }
    ];
    for (const file of input.files) {
      const base64 = typeof file.transientExtractedContent === "string" ? file.transientExtractedContent : typeof file.providerMetadata?.base64 === "string" ? file.providerMetadata.base64 : void 0;
      if (!base64) {
        throw new Error("Gemini provider missing inline data for file");
      }
      parts.push({ inlineData: { mimeType: file.mimeType, data: base64 } });
    }
    const contents = [{ role: "user", parts }];
    const body = {
      model: modelId,
      contents,
      systemInstruction: { parts: [{ text: input.systemPrompt }] },
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 12e3
      }
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(
        `${this.baseUrl}/models/${modelId}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal
        }
      );
      if (!response.ok) {
        const text2 = await response.text().catch(() => "");
        throw new Error(
          `Document analysis request failed: ${response.status} ${text2.slice(0, 200)}`
        );
      }
      const completion = await response.json();
      const text = completion.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== "string") {
        throw new Error("Document analysis response did not contain text content");
      }
      let parsed;
      const trimmed = text.trim();
      if (trimmed.startsWith("```")) {
        const lines = trimmed.split("\n");
        if (lines.length > 1 && lines[0].trim().toLowerCase().startsWith("```")) {
          parsed = JSON.parse(lines.slice(1, -1).join("\n").trim());
        } else {
          parsed = JSON.parse(trimmed);
        }
      } else {
        parsed = JSON.parse(trimmed);
      }
      const documentIds = input.files.map((f) => f.documentId);
      return transformGeminiResponse(parsed, documentIds);
    } finally {
      clearTimeout(timeout);
    }
  }
  async deleteFile() {
    return { deleted: true, attempts: 1 };
  }
};

// src/providers/supabase-adapter.ts
var SupabaseAuthorizationStore = class {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(admin) {
    this.admin = admin;
  }
  admin;
  async createAuthorization(auth) {
    const { data, error } = await this.admin.from("document_processing_authorizations").insert({
      household_id: auth.householdId,
      actor_profile_id: auth.actorProfileId,
      consent_id: auth.consentId,
      purpose: auth.purpose,
      privacy_notice_version: auth.privacyNoticeVersion,
      processor_contract_version: auth.processorContractVersion,
      foreign_processing_acknowledged: auth.foreignProcessingAcknowledged,
      automated_processing_acknowledged: auth.automatedProcessingAcknowledged,
      raw_processing_approved: auth.rawProcessingApproved,
      external_processing_enabled: auth.externalProcessingEnabled,
      authorization_result: auth.authorizationResult
    }).select().single();
    if (error || !data) throw new Error("Failed to persist document processing authorization");
    return { ...auth, id: data.id, authorizedAt: (/* @__PURE__ */ new Date()).toISOString() };
  }
  async updateAuthorization(id, patch) {
    const updates = {};
    if (patch.analysisRequestId !== void 0) {
      updates.analysis_request_id = patch.analysisRequestId;
    }
    if (patch.authorizationResult !== void 0) {
      updates.authorization_result = patch.authorizationResult;
    }
    if (Object.keys(updates).length === 0) return;
    const { error } = await this.admin.from("document_processing_authorizations").update(updates).eq("id", id);
    if (error) throw new Error("Failed to update authorization: " + error.message);
  }
};
var SupabaseFileLifecycleStore = class {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(admin) {
    this.admin = admin;
  }
  admin;
  async recordUpload(record) {
    const { data, error } = await this.admin.from("document_analysis_provider_files").upsert(
      {
        authorization_id: record.authorizationId,
        analysis_request_id: record.analysisRequestId,
        policy_document_id: record.policyDocumentId,
        provider_file_id: record.providerFileId,
        upload_status: record.uploadStatus,
        upload_completed_at: null,
        processing_status: null,
        deletion_status: null,
        deleted_at: null,
        deletion_attempts: 0,
        last_deletion_error_category: null,
        next_deletion_attempt_at: null,
        cleanup_claimed_at: null,
        cleanup_lease_expires_at: null,
        cleanup_worker_id: null
      },
      { onConflict: "policy_document_id" }
    ).select().single();
    if (error || !data) throw new Error("Failed to record file upload: " + (error?.message ?? ""));
    return {
      ...record,
      id: data.id,
      uploadStartedAt: data.upload_started_at ?? (/* @__PURE__ */ new Date()).toISOString(),
      deletionAttempts: 0
    };
  }
  async markUploadCompleted(id, patch) {
    const updates = { upload_completed_at: (/* @__PURE__ */ new Date()).toISOString() };
    if (patch.providerFileId !== void 0) updates.provider_file_id = patch.providerFileId;
    if (patch.uploadStatus !== void 0) updates.upload_status = patch.uploadStatus;
    if (patch.processingStatus !== void 0) updates.processing_status = patch.processingStatus;
    const { error } = await this.admin.from("document_analysis_provider_files").update(updates).eq("id", id);
    if (error) throw new Error("Failed to mark upload completed: " + error.message);
  }
  async recordDeletionAttempt(id, result2) {
    const record = await this.getRecord(id);
    const attempts = record.deletionAttempts + 1;
    const update = { deletion_attempts: attempts };
    if (result2.deleted) {
      update.deletion_status = "deleted";
      update.deleted_at = (/* @__PURE__ */ new Date()).toISOString();
      update.last_deletion_error_category = null;
      update.next_deletion_attempt_at = null;
    } else {
      update.last_deletion_error_category = result2.failureCategory ?? null;
      if (attempts >= 3 && (result2.statusCode ?? 0) >= 500) {
        update.deletion_status = "failed_permanently";
      } else if (!record.nextDeletionAttemptAt) {
        update.deletion_status = "queued";
        const backoffMinutes = Math.min(5 * Math.pow(2, attempts - 1), 60);
        const next = /* @__PURE__ */ new Date();
        next.setMinutes(next.getMinutes() + backoffMinutes);
        update.next_deletion_attempt_at = next.toISOString();
      }
    }
    const { error } = await this.admin.from("document_analysis_provider_files").update(update).eq("id", id);
    if (error) throw new Error("Failed to record deletion attempt: " + error.message);
    await this.admin.from("document_analysis_cleanup_attempts").insert({
      file_id: id,
      status_code: result2.statusCode ?? null,
      failure_category: result2.failureCategory ?? null,
      success: result2.deleted
    });
  }
  async queueCleanup(id, failureCategory, nextAttemptAt, providerFileId) {
    if (!providerFileId || providerFileId === "pending") {
      throw new Error("Cannot queue cleanup without actual provider file id");
    }
    const update = {
      deletion_status: "queued",
      last_deletion_error_category: failureCategory,
      next_deletion_attempt_at: nextAttemptAt,
      provider_file_id: providerFileId
    };
    const { error } = await this.admin.from("document_analysis_provider_files").update(update).eq("id", id);
    if (error) throw new Error("Failed to queue cleanup: " + error.message);
    await this.admin.from("document_analysis_cleanup_attempts").insert({
      file_id: id,
      failure_category: failureCategory,
      success: false,
      next_attempt_at: nextAttemptAt
    });
  }
  async recordEmergencyCleanup(providerFileId, policyDocumentId, failureCategory) {
    const { error } = await this.admin.from("document_analysis_emergency_cleanup").insert({
      provider_file_id: providerFileId,
      policy_document_id: policyDocumentId,
      failure_category: failureCategory,
      cleanup_status: "pending",
      next_attempt_at: (/* @__PURE__ */ new Date()).toISOString(),
      retries: 0,
      operator_action_required: false,
      last_failure_category: failureCategory ?? null
    });
    if (error) throw new Error("Failed to record emergency cleanup: " + error.message);
  }
  async getRecord(id) {
    const { data, error } = await this.admin.from("document_analysis_provider_files").select("*").eq("id", id).single();
    if (error || !data) throw new Error("Failed to load file record: " + (error?.message ?? ""));
    return {
      id: String(data.id),
      authorizationId: String(data.authorization_id),
      analysisRequestId: data.analysis_request_id ? String(data.analysis_request_id) : void 0,
      policyDocumentId: String(data.policy_document_id),
      providerFileId: String(data.provider_file_id),
      uploadStartedAt: String(data.upload_started_at),
      uploadCompletedAt: data.upload_completed_at ? String(data.upload_completed_at) : void 0,
      uploadStatus: String(data.upload_status),
      processingStatus: data.processing_status ? String(data.processing_status) : void 0,
      deletionStatus: data.deletion_status ? String(data.deletion_status) : void 0,
      deletedAt: data.deleted_at ? String(data.deleted_at) : void 0,
      deletionAttempts: Number(data.deletion_attempts ?? 0),
      lastDeletionErrorCategory: data.last_deletion_error_category ? String(data.last_deletion_error_category) : void 0,
      nextDeletionAttemptAt: data.next_deletion_attempt_at ? String(data.next_deletion_attempt_at) : void 0
    };
  }
};

// src/document-loaders/memory-bytes.ts
var MemoryFileBytesLoader = class {
  bytesByReference;
  constructor(bytesByReference) {
    this.bytesByReference = new Map(Object.entries(bytesByReference));
  }
  async load(document) {
    const bytes = this.bytesByReference.get(document.fileReference);
    if (!bytes) {
      throw new Error(`Document bytes not found for reference ${document.fileReference}`);
    }
    return {
      documentId: document.documentId,
      filename: document.filename,
      mimeType: document.mimeType,
      bytes
    };
  }
};
export {
  AnalysisWarningSchema,
  AnalyzedDocumentSchema,
  CandidateIdentitySchema,
  ConfigAndConsentPrivacyPreparation,
  CurrentPolicySchema,
  DANGEROUS_MODE_DISCLOSURE_VERSION,
  DetectedConflictSchema,
  DetectedEntityIdentitySchema,
  DetectedInsuranceEntitySchema,
  EntityResolutionSchema,
  EntityResolutionStatusSchema,
  EvidenceReferenceSchema,
  ExistingHouseholdAssetSchema,
  ExtractedAlternativeValueSchema,
  ExtractedCurrentValueSchema,
  GeminiFlashLiteProvider,
  HttpLlmProvider,
  InsuranceDocumentAnalysisInputSchema,
  InsuranceDocumentAnalysisResultSchema,
  JsonValueSchema,
  KimiK3Provider,
  LLM_EXTRACTION_PROMPT_VERSION,
  LLM_EXTRACTION_SCHEMA_VERSION,
  LLM_PARSED_DOCUMENT_PROJECTION_VERSION,
  LLM_PIPELINE_VERSION,
  LLM_SEMANTIC_VALIDATION_VERSION,
  LlmAlternativeValueSchema,
  LlmAssertionSchema,
  LlmAssetCandidateSchema,
  LlmConflictSchema,
  LlmCoverageActivitySchema,
  LlmEvidenceSchema,
  LlmExtractionPassSchema,
  LlmExtractionRequestSchema,
  LlmExtractionResultSchema,
  LlmFactStatusSchema,
  LlmFirstDocumentAnalyzer,
  LlmModelIdentitySchema,
  LlmPageInputSchema,
  LlmPolicyTermSchema,
  LlmPropertyCandidateSchema,
  LlmSemanticValidationError,
  LlmSourceAuthoritySchema,
  LlmTemporalApplicabilitySchema,
  LlmVehicleCandidateSchema,
  MANDATE_FIELD_DEFINITIONS,
  MandateRuleSchema,
  MemoryFileBytesLoader,
  OpenAiGpt5MiniProvider,
  PendingEntityCandidateSchema,
  PriorDocumentSummarySchema,
  SupabaseAuthorizationStore,
  SupabaseFileLifecycleStore,
  UploadedDocumentSchema,
  assertLlmExtractionSemantics,
  buildCandidateContext,
  buildCandidateIdentity,
  buildCandidateMandateValues,
  buildInsuranceAnalysisSystemPrompt,
  buildInsuranceExtractionSystemPrompt,
  buildMandateReviewSeeds,
  buildPropertyIdentity,
  buildVehicleIdentity,
  canAutoMergeIdentity,
  createEmptyIncrementalOnboardingSession,
  createKimiK3Analyzer,
  createLlmFirstAnalyzer,
  createNativeDocumentAnalyzer,
  documentProcessingRoute,
  generateSupportReference,
  mergeIncrementalOnboardingUpload,
  normalizeDocumentValueState,
  normalizeLlmAnalysisResult,
  parseDocument,
  parseLlmExtractionResult,
  partitionDocumentDigests,
  planDocumentIntake,
  privacyPreparationConfigFromEnv,
  projectLlmRunToParsedDocument,
  publicErrorResponse,
  resolveLlmAssetIdentity,
  runInsuranceLlmPipeline,
  runLlmExtraction,
  sanitizeProviderError,
  stripNullValues,
  validateDangerousModeEnablePolicy,
  validateLlmExtractionSemantics
};
// document-extraction-edge-bundle end


export const __DOCUMENT_EXTRACTION_SOURCE_HASH__ = "ddc3cfdf57cd4215297ab5c4577db1ddcd782faa3b6ccc07b56d272a7dbc300f";
