// This file is generated from packages/insurance-engine. Do not edit manually.
// source-hash: 16263236150319eef57083603a09a54710ad9dda1b142ae24f69f37c076c288c


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
  objectUtil2.mergeShapes = (first2, second) => {
    return {
      ...first2,
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
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
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
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
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
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
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
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
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
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
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
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
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
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
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
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
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
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
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
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
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
  static create(first2, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first2,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first2,
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
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
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
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
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
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
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
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return base;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({ status: status.value, value: result }));
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
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
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
        value: result.status === "valid" ? result.value : this._def.catchValue({
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
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
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

// ../schemas/src/enums.ts
var userRoles = ["customer", "operations", "reviewer", "admin"];
var UserRole = z.enum(userRoles);
var caseStates = [
  "draft",
  "awaiting_documents",
  "extracting_information",
  "awaiting_customer_confirmation",
  "ready_for_market_search",
  "requesting_quotes",
  "awaiting_quotes",
  "comparing_quotes",
  "licensed_review",
  "recommendation_ready",
  "customer_decision",
  "switching",
  "completed",
  "retained_incumbent",
  "cancelled"
];
var CaseState = z.enum(caseStates);
var quoteRequestStates = [
  "draft",
  "queued",
  "sent",
  "additional_information_required",
  "response_received",
  "declined",
  "no_response",
  "cancelled"
];
var QuoteRequestState = z.enum(quoteRequestStates);
var quoteStates = [
  "estimate",
  "conditional",
  "bindable",
  "expired",
  "rejected",
  "selected"
];
var QuoteState = z.enum(quoteStates);
var quoteValidationStatuses = [
  "draft",
  "incomplete",
  "valid",
  "invalid",
  "superseded"
];
var QuoteValidationStatus = z.enum(quoteValidationStatuses);
var quoteDataSources = [
  "manual_entry",
  "insurer_document",
  "insurer_portal",
  "api",
  "customer_confirmed",
  "migration_unknown"
];
var QuoteDataSource = z.enum(quoteDataSources);
var switchStates = [
  "customer_approved",
  "replacement_pending",
  "replacement_confirmed",
  "incumbent_cancellation_pending",
  "incumbent_cancelled",
  "completed",
  "failed"
];
var SwitchState = z.enum(switchStates);
var productLines = ["auto", "property"];
var ProductLine = z.enum(productLines);
var documentCategories = [
  "current_auto_policy",
  "current_property_policy",
  "renewal_notice",
  "competing_quote",
  "proof_of_insurance",
  "signed_authorization",
  "cancellation_confirmation",
  "other"
];
var DocumentCategory = z.enum(documentCategories);
var documentStatuses = ["uploaded", "in_review", "extracted", "rejected"];
var DocumentStatus = z.enum(documentStatuses);
var questionTypes = [
  "yes_no",
  "single_choice",
  "multiple_choice",
  "number",
  "date",
  "short_text"
];
var QuestionType = z.enum(questionTypes);
var questionStatuses = ["pending", "answered", "cancelled"];
var QuestionStatus = z.enum(questionStatuses);
var consentTypes = [
  "store_documents",
  "share_for_quotation",
  "generate_recommendations",
  "electronic_communications"
];
var ConsentType = z.enum(consentTypes);
var subscriptionStatuses = [
  "inactive",
  "pending",
  "active",
  "past_due",
  "cancelled"
];
var SubscriptionStatus = z.enum(subscriptionStatuses);
var recommendationStatuses = [
  "draft",
  "awaiting_review",
  "approved",
  "rejected",
  "published",
  "customer_approved",
  "customer_declined",
  "superseded"
];
var RecommendationStatus = z.enum(recommendationStatuses);
var notificationChannels = ["push", "email", "local_log"];
var NotificationChannel = z.enum(notificationChannels);
var coveragePreferences = ["required", "preferred", "indifferent", "prohibited"];
var CoveragePreference = z.enum(coveragePreferences);
var limitRules = [
  "minimum",
  "maximum",
  "exact",
  "match_current_or_better",
  "any"
];
var LimitRule = z.enum(limitRules);
var deductibleRules = ["maximum", "exact", "match_current_or_better", "any"];
var DeductibleRule = z.enum(deductibleRules);
var autoCoverageForms = [
  "unknown",
  "liability_only",
  "collision",
  "comprehensive",
  "specified_perils",
  "all_perils"
];
var AutoCoverageForm = z.enum(autoCoverageForms);
var propertyTypes = [
  "homeowner",
  "condo",
  "tenant",
  "landlord",
  "seasonal",
  "secondary_residence",
  "unknown"
];
var PropertyType = z.enum(propertyTypes);
var propertyCoverageForms = [
  "unknown",
  "comprehensive",
  "broad",
  "named_perils",
  "basic"
];
var PropertyCoverageForm = z.enum(propertyCoverageForms);
var propertySettlements = [
  "unknown",
  "replacement_cost",
  "guaranteed_replacement_cost",
  "extended_replacement_cost",
  "actual_cash_value"
];
var PropertySettlement = z.enum(propertySettlements);
var vehicleUseClasses = [
  "personal",
  "commercial",
  "classic",
  "modified",
  "unknown"
];
var VehicleUseClass = z.enum(vehicleUseClasses);
var financingStatuses = ["owned", "financed", "leased", "unknown"];
var FinancingStatus = z.enum(financingStatuses);
var paymentFrequencies = ["monthly", "quarterly", "semi_annual", "annual"];
var PaymentFrequency = z.enum(paymentFrequencies);
var billingMethods = ["automatic_bank", "credit_card", "mail"];
var BillingMethod = z.enum(billingMethods);
var brokerDirectPreferences = ["broker", "direct", "indifferent"];
var BrokerDirectPreference = z.enum(brokerDirectPreferences);
var insurerFinancialRatings = [
  "unknown",
  "A_plus",
  "A",
  "A_minus",
  "B_plus",
  "B_or_lower"
];
var InsurerFinancialRating = z.enum(insurerFinancialRatings);
var customerMinimumInsurerFinancialRatings = [
  "any",
  "A_plus",
  "A",
  "A_minus",
  "B_plus",
  "B_or_lower"
];
var CustomerMinimumInsurerFinancialRating = z.enum(customerMinimumInsurerFinancialRatings);
var FinancialRating = CustomerMinimumInsurerFinancialRating;

// ../schemas/src/money.ts
var Cents = z.number().int();
var NonNegativeCents = Cents.nonnegative();

// ../schemas/src/mandate.ts
var LimitRequirement = z.object({
  rule: LimitRule,
  cents: NonNegativeCents.default(0)
});
var DeductibleRequirement = z.object({
  rule: DeductibleRule,
  cents: NonNegativeCents.default(0)
});
var AutoCoverageFormRequirement = z.object({
  preference: CoveragePreference,
  value: AutoCoverageForm.default("comprehensive")
});
var PropertyCoverageFormRequirement = z.object({
  preference: CoveragePreference,
  value: PropertyCoverageForm.default("comprehensive")
});
var PropertySettlementRequirement = z.object({
  preference: CoveragePreference,
  value: PropertySettlement.default("replacement_cost")
});
var autoEndorsementKeys = [
  "accident_forgiveness",
  "rental_vehicle_coverage",
  "non_owned_automobile",
  "family_protection",
  "depreciation_waiver",
  "oem_parts",
  "roadside_assistance",
  "disappearing_deductible",
  "glass_coverage",
  "telematics"
];
var AutoEndorsementKey = z.enum(autoEndorsementKeys);
var autoEndorsementDefaults = Object.fromEntries(
  autoEndorsementKeys.map((k) => [k, CoveragePreference.default("indifferent")])
);
var AutoEndorsementPreferences = z.object(autoEndorsementDefaults);
var defaultAutoEndorsements = Object.fromEntries(
  autoEndorsementKeys.map((k) => [k, "indifferent"])
);
var AutoRequirements = z.object({
  coverageForm: AutoCoverageFormRequirement.default({
    preference: "required",
    value: "comprehensive"
  }),
  liability: LimitRequirement.default({ rule: "minimum", cents: 2e8 }),
  collisionDeductible: DeductibleRequirement.default({ rule: "maximum", cents: 1e5 }),
  comprehensiveDeductible: DeductibleRequirement.default({ rule: "maximum", cents: 1e5 }),
  glassDeductible: DeductibleRequirement.default({ rule: "any", cents: 0 }),
  endorsements: AutoEndorsementPreferences.default(defaultAutoEndorsements),
  vehicleClass: VehicleUseClass.optional(),
  financingStatus: FinancingStatus.optional()
});
var propertyOptionalCoverageKeys = [
  "equipment_breakdown",
  "service_line",
  "bylaw_coverage",
  "home_systems",
  "cyber",
  "scheduled_valuables",
  "home_business",
  "short_term_rental_permission",
  "claims_forgiveness",
  "groundwater_seepage",
  "ice_dam",
  "earthquake"
];
var PropertyOptionalCoverageKey = z.enum(propertyOptionalCoverageKeys);
var propertyOptionalCoverageDefaults = Object.fromEntries(
  propertyOptionalCoverageKeys.map((k) => [k, CoveragePreference.default("indifferent")])
);
var PropertyOptionalCoveragePreferences = z.object(propertyOptionalCoverageDefaults);
var defaultPropertyOptionalCoverages = Object.fromEntries(
  propertyOptionalCoverageKeys.map((k) => [k, "indifferent"])
);
var WaterCoverageRequirement = z.object({
  preference: CoveragePreference,
  limit: LimitRequirement.default({ rule: "any", cents: 0 }),
  deductible: DeductibleRequirement.default({ rule: "any", cents: 0 })
});
var PropertyRequirements = z.object({
  propertyType: PropertyType.optional(),
  coverageForm: PropertyCoverageFormRequirement.default({
    preference: "required",
    value: "comprehensive"
  }),
  settlementBasis: PropertySettlementRequirement.default({
    preference: "required",
    value: "replacement_cost"
  }),
  dwellingLimit: LimitRequirement.default({ rule: "minimum", cents: 45e6 }),
  contentsLimit: LimitRequirement.default({ rule: "any", cents: 0 }),
  detachedStructuresLimit: LimitRequirement.default({ rule: "any", cents: 0 }),
  personalLiabilityLimit: LimitRequirement.default({ rule: "any", cents: 0 }),
  additionalLivingExpenseLimit: LimitRequirement.default({ rule: "any", cents: 0 }),
  baseDeductible: DeductibleRequirement.default({ rule: "maximum", cents: 25e4 }),
  waterDeductible: DeductibleRequirement.default({ rule: "any", cents: 0 }),
  windHailDeductible: DeductibleRequirement.default({ rule: "any", cents: 0 }),
  earthquakeDeductible: DeductibleRequirement.default({ rule: "any", cents: 0 }),
  sewerBackup: WaterCoverageRequirement.default({ preference: "indifferent" }),
  overlandWater: WaterCoverageRequirement.default({ preference: "indifferent" }),
  optionalCoverages: PropertyOptionalCoveragePreferences.default(defaultPropertyOptionalCoverages)
});
var SwitchingPreferences = z.object({
  minNetAnnualSavingsCents: NonNegativeCents.default(2e4),
  maxPremiumIncreaseCents: NonNegativeCents.default(0),
  maxDeductibleIncreaseCents: NonNegativeCents.default(0),
  renewalOnlySwitching: z.boolean().default(true),
  householdOptimizationEnabled: z.boolean().default(true),
  splitInsurersAllowed: z.boolean().default(true),
  allowBundleBreakup: z.boolean().default(false),
  excludedInsurerIds: z.array(z.string().uuid()).default([]),
  deductibleIncreasesAllowed: z.boolean().default(false),
  materialCoverageReductionsAllowed: z.boolean().default(false),
  customerApprovalRequired: z.literal(true).default(true),
  switchOnlyAfterCustomerApproval: z.boolean().default(true),
  preferredPaymentFrequency: PaymentFrequency.default("annual"),
  preferredBillingMethod: BillingMethod.default("automatic_bank"),
  brokerDirectPreference: BrokerDirectPreference.default("indifferent"),
  minimumInsurerFinancialRating: FinancialRating.default("any")
});
var AssetAutoOverride = AutoRequirements.partial();
var AssetPropertyOverride = PropertyRequirements.partial();
var HouseholdMandate = z.object({
  auto: AutoRequirements,
  property: PropertyRequirements,
  switching: SwitchingPreferences,
  vehicleOverrides: z.record(z.string().uuid(), AssetAutoOverride).default({}),
  propertyOverrides: z.record(z.string().uuid(), AssetPropertyOverride).default({})
});

// ../schemas/src/mandate-v2.ts
var MonetaryRule = z.discriminatedUnion("rule", [
  z.object({ rule: z.literal("minimum"), amountCents: NonNegativeCents }).strict(),
  z.object({ rule: z.literal("maximum"), amountCents: NonNegativeCents }).strict(),
  z.object({ rule: z.literal("exact"), amountCents: NonNegativeCents }).strict(),
  z.object({ rule: z.literal("match_current_or_better") }).strict(),
  z.object({ rule: z.literal("any") }).strict()
]);
var autoEndorsementKeys2 = AutoEndorsementKey.options;
var propertyOptionalCoverageKeys2 = PropertyOptionalCoverageKey.options;
var AutoEndorsementPreferencesV2 = z.object(
  Object.fromEntries(autoEndorsementKeys2.map((key) => [key, CoveragePreference]))
);
var PropertyOptionalCoveragePreferencesV2 = z.object(
  Object.fromEntries(
    propertyOptionalCoverageKeys2.map((key) => [key, CoveragePreference])
  )
);
var WaterCoverageRequirementV2 = z.object({
  preference: CoveragePreference,
  limit: MonetaryRule,
  deductible: MonetaryRule
}).strict();
var AutoCoverageFormRequirementV2 = z.object({
  preference: CoveragePreference,
  value: AutoCoverageForm
});
var AutoMandateV2 = z.object({
  coverageForm: AutoCoverageFormRequirementV2,
  liability: MonetaryRule,
  collisionDeductible: MonetaryRule,
  comprehensiveDeductible: MonetaryRule,
  glassDeductible: MonetaryRule,
  endorsements: AutoEndorsementPreferencesV2
}).strict();
var PropertyCoverageFormRequirementV2 = z.object({
  preference: CoveragePreference,
  value: PropertyCoverageForm
});
var PropertySettlementRequirementV2 = z.object({
  preference: CoveragePreference,
  value: PropertySettlement
});
var PropertyMandateV2 = z.object({
  coverageForm: PropertyCoverageFormRequirementV2,
  settlementBasis: PropertySettlementRequirementV2,
  dwellingLimit: MonetaryRule,
  contentsLimit: MonetaryRule,
  detachedStructuresLimit: MonetaryRule,
  personalLiabilityLimit: MonetaryRule,
  additionalLivingExpenseLimit: MonetaryRule,
  baseDeductible: MonetaryRule,
  waterDeductible: MonetaryRule,
  windHailDeductible: MonetaryRule,
  earthquakeDeductible: MonetaryRule,
  sewerBackup: WaterCoverageRequirementV2,
  overlandWater: WaterCoverageRequirementV2,
  optionalCoverages: PropertyOptionalCoveragePreferencesV2
}).strict();
var AutoMandateOverrideValuesV2 = z.object({
  coverageForm: AutoCoverageFormRequirementV2.optional(),
  liability: MonetaryRule.optional(),
  collisionDeductible: MonetaryRule.optional(),
  comprehensiveDeductible: MonetaryRule.optional(),
  glassDeductible: MonetaryRule.optional(),
  endorsements: AutoEndorsementPreferencesV2.partial().optional()
}).strict();
var VehicleMandateOverrideV2 = z.object({
  vehicleId: z.string().uuid(),
  values: AutoMandateOverrideValuesV2
}).strict();
var PropertyMandateOverrideValuesV2 = z.object({
  coverageForm: PropertyCoverageFormRequirementV2.optional(),
  settlementBasis: PropertySettlementRequirementV2.optional(),
  dwellingLimit: MonetaryRule.optional(),
  contentsLimit: MonetaryRule.optional(),
  detachedStructuresLimit: MonetaryRule.optional(),
  personalLiabilityLimit: MonetaryRule.optional(),
  additionalLivingExpenseLimit: MonetaryRule.optional(),
  baseDeductible: MonetaryRule.optional(),
  waterDeductible: MonetaryRule.optional(),
  windHailDeductible: MonetaryRule.optional(),
  earthquakeDeductible: MonetaryRule.optional(),
  sewerBackup: WaterCoverageRequirementV2.partial().optional(),
  overlandWater: WaterCoverageRequirementV2.partial().optional(),
  optionalCoverages: PropertyOptionalCoveragePreferencesV2.partial().optional()
}).strict();
var PropertyMandateOverrideV2 = z.object({
  propertyId: z.string().uuid(),
  values: PropertyMandateOverrideValuesV2
}).strict();
var HouseholdCoverageMandateV2 = z.object({
  schemaVersion: z.literal(2),
  jurisdiction: z.literal("AB"),
  version: z.number().int().positive(),
  effectiveFrom: z.string().datetime(),
  householdAutoDefaults: AutoMandateV2,
  householdPropertyDefaults: PropertyMandateV2,
  vehicleOverrides: z.array(VehicleMandateOverrideV2).default([]),
  propertyOverrides: z.array(PropertyMandateOverrideV2).default([])
}).strict();
var SwitchingPreferencesV2 = z.object({
  minNetAnnualSavingsCents: NonNegativeCents.default(2e4),
  maxPremiumIncreaseCents: NonNegativeCents.default(0),
  maxDeductibleIncreaseCents: NonNegativeCents.default(0),
  renewalOnlySwitching: z.boolean().default(true),
  householdOptimizationEnabled: z.boolean().default(true),
  splitInsurersAllowed: z.boolean().default(true),
  allowBundleBreakup: z.boolean().default(false),
  excludedInsurerIds: z.array(z.string().uuid()).default([]),
  deductibleIncreasesAllowed: z.boolean().default(false),
  materialCoverageReductionsAllowed: z.boolean().default(false),
  customerApprovalRequired: z.literal(true).default(true),
  switchOnlyAfterCustomerApproval: z.boolean().default(true),
  preferredPaymentFrequency: PaymentFrequency.default("annual"),
  preferredBillingMethod: BillingMethod.default("automatic_bank"),
  brokerDirectPreference: BrokerDirectPreference.default("indifferent"),
  minimumInsurerFinancialRating: CustomerMinimumInsurerFinancialRating.default("any")
});
function createDefaultSwitchingPreferencesV2() {
  return SwitchingPreferencesV2.parse({});
}
function resolveVehicleMandateV2(defaults, override) {
  if (!override) return defaults;
  const v = override.values;
  return AutoMandateV2.parse({
    coverageForm: v.coverageForm ? { ...defaults.coverageForm, ...v.coverageForm } : defaults.coverageForm,
    liability: v.liability ?? defaults.liability,
    collisionDeductible: v.collisionDeductible ?? defaults.collisionDeductible,
    comprehensiveDeductible: v.comprehensiveDeductible ?? defaults.comprehensiveDeductible,
    glassDeductible: v.glassDeductible ?? defaults.glassDeductible,
    endorsements: v.endorsements ? { ...defaults.endorsements, ...v.endorsements } : defaults.endorsements
  });
}
function resolvePropertyMandateV2(defaults, override) {
  if (!override) return defaults;
  const v = override.values;
  return PropertyMandateV2.parse({
    coverageForm: v.coverageForm ? { ...defaults.coverageForm, ...v.coverageForm } : defaults.coverageForm,
    settlementBasis: v.settlementBasis ? { ...defaults.settlementBasis, ...v.settlementBasis } : defaults.settlementBasis,
    dwellingLimit: v.dwellingLimit ?? defaults.dwellingLimit,
    contentsLimit: v.contentsLimit ?? defaults.contentsLimit,
    detachedStructuresLimit: v.detachedStructuresLimit ?? defaults.detachedStructuresLimit,
    personalLiabilityLimit: v.personalLiabilityLimit ?? defaults.personalLiabilityLimit,
    additionalLivingExpenseLimit: v.additionalLivingExpenseLimit ?? defaults.additionalLivingExpenseLimit,
    baseDeductible: v.baseDeductible ?? defaults.baseDeductible,
    waterDeductible: v.waterDeductible ?? defaults.waterDeductible,
    windHailDeductible: v.windHailDeductible ?? defaults.windHailDeductible,
    earthquakeDeductible: v.earthquakeDeductible ?? defaults.earthquakeDeductible,
    sewerBackup: v.sewerBackup ? { ...defaults.sewerBackup, ...v.sewerBackup } : defaults.sewerBackup,
    overlandWater: v.overlandWater ? { ...defaults.overlandWater, ...v.overlandWater } : defaults.overlandWater,
    optionalCoverages: v.optionalCoverages ? { ...defaults.optionalCoverages, ...v.optionalCoverages } : defaults.optionalCoverages
  });
}

// ../schemas/src/mandate-adapters.ts
function monetaryRuleV2ToLegacyLimit(rule) {
  const r = LimitRule.parse(rule.rule);
  const cents = "amountCents" in rule ? rule.amountCents : 0;
  return LimitRequirement.parse({ rule: r, cents });
}
function monetaryRuleV2ToLegacyDeductible(rule) {
  const r = DeductibleRule.parse(rule.rule);
  const cents = "amountCents" in rule ? rule.amountCents : 0;
  return DeductibleRequirement.parse({ rule: r, cents });
}
function v2WaterToLegacy(water) {
  return {
    preference: water.preference,
    limit: monetaryRuleV2ToLegacyLimit(water.limit),
    deductible: monetaryRuleV2ToLegacyDeductible(water.deductible)
  };
}
function v2AutoMandateToLegacy(auto) {
  return {
    coverageForm: AutoCoverageFormRequirement.parse(auto.coverageForm),
    liability: monetaryRuleV2ToLegacyLimit(auto.liability),
    collisionDeductible: monetaryRuleV2ToLegacyDeductible(auto.collisionDeductible),
    comprehensiveDeductible: monetaryRuleV2ToLegacyDeductible(auto.comprehensiveDeductible),
    glassDeductible: monetaryRuleV2ToLegacyDeductible(auto.glassDeductible),
    endorsements: AutoEndorsementPreferences.parse(auto.endorsements)
  };
}
function v2PropertyMandateToLegacy(property) {
  return {
    coverageForm: PropertyCoverageFormRequirement.parse(property.coverageForm),
    settlementBasis: PropertySettlementRequirement.parse(property.settlementBasis),
    dwellingLimit: monetaryRuleV2ToLegacyLimit(property.dwellingLimit),
    contentsLimit: monetaryRuleV2ToLegacyLimit(property.contentsLimit),
    detachedStructuresLimit: monetaryRuleV2ToLegacyLimit(property.detachedStructuresLimit),
    personalLiabilityLimit: monetaryRuleV2ToLegacyLimit(property.personalLiabilityLimit),
    additionalLivingExpenseLimit: monetaryRuleV2ToLegacyLimit(
      property.additionalLivingExpenseLimit
    ),
    baseDeductible: monetaryRuleV2ToLegacyDeductible(property.baseDeductible),
    waterDeductible: monetaryRuleV2ToLegacyDeductible(property.waterDeductible),
    windHailDeductible: monetaryRuleV2ToLegacyDeductible(property.windHailDeductible),
    earthquakeDeductible: monetaryRuleV2ToLegacyDeductible(property.earthquakeDeductible),
    sewerBackup: v2WaterToLegacy(property.sewerBackup),
    overlandWater: v2WaterToLegacy(property.overlandWater),
    optionalCoverages: PropertyOptionalCoveragePreferences.parse(property.optionalCoverages)
  };
}
function v2ResolvedAutoMandateToLegacy(resolved) {
  return v2AutoMandateToLegacy(resolved);
}
function v2ResolvedPropertyMandateToLegacy(resolved) {
  return v2PropertyMandateToLegacy(resolved);
}
function collectVehicleIds(v2) {
  return new Set(v2.vehicleOverrides.map((o) => o.vehicleId));
}
function collectPropertyIds(v2) {
  return new Set(v2.propertyOverrides.map((o) => o.propertyId));
}
function mandateV2ToEngineMandate(v2, switching) {
  const vehicleOverrides = {};
  for (const vehicleId of collectVehicleIds(v2)) {
    const resolved = resolveVehicleMandateV2(
      v2.householdAutoDefaults,
      v2.vehicleOverrides.find((o) => o.vehicleId === vehicleId)
    );
    vehicleOverrides[vehicleId] = v2ResolvedAutoMandateToLegacy(resolved);
  }
  const propertyOverrides = {};
  for (const propertyId of collectPropertyIds(v2)) {
    const resolved = resolvePropertyMandateV2(
      v2.householdPropertyDefaults,
      v2.propertyOverrides.find((o) => o.propertyId === propertyId)
    );
    propertyOverrides[propertyId] = v2ResolvedPropertyMandateToLegacy(resolved);
  }
  return {
    auto: v2AutoMandateToLegacy(v2.householdAutoDefaults),
    property: v2PropertyMandateToLegacy(v2.householdPropertyDefaults),
    switching: switching ?? createDefaultSwitchingPreferencesV2(),
    vehicleOverrides,
    propertyOverrides
  };
}
function switchingRowToDomain(row) {
  return SwitchingPreferencesV2.parse({
    minNetAnnualSavingsCents: row.min_net_annual_savings_cents,
    maxPremiumIncreaseCents: row.max_premium_increase_cents,
    maxDeductibleIncreaseCents: row.max_deductible_increase_cents,
    renewalOnlySwitching: row.renewal_only_switching,
    householdOptimizationEnabled: row.household_optimization_enabled,
    splitInsurersAllowed: row.split_insurers_allowed,
    allowBundleBreakup: row.allow_bundle_breakup,
    excludedInsurerIds: row.excluded_insurer_ids ?? [],
    deductibleIncreasesAllowed: row.deductible_increases_allowed,
    materialCoverageReductionsAllowed: row.material_coverage_reductions_allowed,
    customerApprovalRequired: !!row.customer_approval_required,
    switchOnlyAfterCustomerApproval: row.switch_only_after_customer_approval,
    preferredPaymentFrequency: row.preferred_payment_frequency,
    preferredBillingMethod: row.preferred_billing_method,
    brokerDirectPreference: row.broker_direct_preference,
    minimumInsurerFinancialRating: row.minimum_insurer_financial_rating
  });
}

// ../schemas/src/quotes.ts
var AutoCoverageDetails = z.object({
  thirdPartyLiabilityCents: NonNegativeCents,
  coverageForm: AutoCoverageForm,
  collisionIncluded: z.boolean(),
  collisionDeductibleCents: NonNegativeCents.nullable(),
  comprehensiveIncluded: z.boolean(),
  comprehensiveDeductibleCents: NonNegativeCents.nullable(),
  glassDeductibleCents: NonNegativeCents.nullable(),
  accidentForgivenessIncluded: z.boolean(),
  rentalVehicleCoverageIncluded: z.boolean(),
  nonOwnedAutomobileIncluded: z.boolean(),
  familyProtectionIncluded: z.boolean(),
  depreciationWaiverIncluded: z.boolean(),
  oemPartsIncluded: z.boolean(),
  roadsideAssistanceIncluded: z.boolean(),
  disappearingDeductibleIncluded: z.boolean(),
  glassCoverageIncluded: z.boolean(),
  telematicsRequired: z.boolean(),
  vehicleClass: VehicleUseClass,
  financingStatus: FinancingStatus
});
var PropertyCoverageDetails = z.object({
  propertyType: PropertyType,
  coverageForm: PropertyCoverageForm,
  settlementBasis: PropertySettlement,
  dwellingLimitCents: NonNegativeCents,
  contentsLimitCents: NonNegativeCents,
  detachedStructuresLimitCents: NonNegativeCents,
  personalLiabilityLimitCents: NonNegativeCents,
  additionalLivingExpenseLimitCents: NonNegativeCents,
  baseDeductibleCents: NonNegativeCents,
  waterDeductibleCents: NonNegativeCents.nullable(),
  windHailIncluded: z.boolean(),
  windHailDeductibleCents: NonNegativeCents.nullable(),
  earthquakeIncluded: z.boolean(),
  earthquakeDeductibleCents: NonNegativeCents.nullable(),
  sewerBackupIncluded: z.boolean(),
  sewerBackupLimitCents: NonNegativeCents.nullable(),
  sewerBackupDeductibleCents: NonNegativeCents.nullable(),
  overlandWaterIncluded: z.boolean(),
  overlandWaterLimitCents: NonNegativeCents.nullable(),
  overlandWaterDeductibleCents: NonNegativeCents.nullable(),
  groundwaterIncluded: z.boolean(),
  iceDamIncluded: z.boolean(),
  equipmentBreakdownIncluded: z.boolean(),
  serviceLineIncluded: z.boolean(),
  bylawCoverageIncluded: z.boolean(),
  homeSystemsIncluded: z.boolean(),
  cyberCoverageIncluded: z.boolean(),
  scheduledValuablesIncluded: z.boolean(),
  homeBusinessIncluded: z.boolean(),
  shortTermRentalPermissionIncluded: z.boolean(),
  claimsForgivenessIncluded: z.boolean()
});
var QuoteComponent = z.object({
  id: z.string().uuid().optional(),
  productLine: ProductLine,
  assetId: z.string().uuid().nullable().optional(),
  assetLabel: z.string().optional(),
  annualPremiumCents: NonNegativeCents,
  auto: AutoCoverageDetails.nullable(),
  property: PropertyCoverageDetails.nullable(),
  validationStatus: QuoteValidationStatus.default("valid"),
  validationErrors: z.array(
    z.object({
      path: z.array(z.string()),
      code: z.string(),
      message: z.string()
    })
  ).default([])
});
var EngineQuote = z.object({
  id: z.string(),
  insurerId: z.string(),
  insurerName: z.string(),
  state: QuoteState,
  isIncumbent: z.boolean(),
  policyFeesCents: NonNegativeCents,
  paymentFeesCents: NonNegativeCents,
  /** Discount applied when this quote's insurer holds both product lines. Negative reduction expressed as positive cents. */
  bundleDiscountCents: NonNegativeCents,
  /** Charge incurred by leaving the incumbent mid-term for this line, if known. */
  cancellationChargeCents: NonNegativeCents,
  underwritingConditions: z.array(z.string()),
  components: z.array(QuoteComponent).min(1),
  expiresAt: z.string().datetime().nullable(),
  paymentFrequency: PaymentFrequency.optional(),
  billingMethod: BillingMethod.optional(),
  distributionChannel: BrokerDirectPreference.optional(),
  insurerFinancialRating: InsurerFinancialRating.optional()
});
var QuoteValidationIssue = z.object({
  path: z.array(z.string()),
  code: z.string(),
  expected: z.string().optional(),
  received: z.unknown(),
  message: z.string()
});
var AutoCoverageDetailsDraft = AutoCoverageDetails;
var PropertyCoverageDetailsDraft = PropertyCoverageDetails;
var QuoteComponentDraft = z.discriminatedUnion("productLine", [
  z.object({
    componentId: z.string().uuid().optional(),
    productLine: z.literal("auto"),
    assetId: z.string().uuid(),
    annualPremiumCents: NonNegativeCents,
    coverage: AutoCoverageDetailsDraft
  }),
  z.object({
    componentId: z.string().uuid().optional(),
    productLine: z.literal("property"),
    assetId: z.string().uuid(),
    annualPremiumCents: NonNegativeCents,
    coverage: PropertyCoverageDetailsDraft
  })
]);
var SaveCaseQuoteRequest = z.object({
  caseId: z.string().uuid(),
  quoteId: z.string().uuid().optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
  insurerId: z.string().uuid(),
  state: QuoteState,
  isIncumbent: z.boolean(),
  expiresAt: z.string().datetime().nullable().optional(),
  policyFeesCents: NonNegativeCents.default(0),
  paymentFeesCents: NonNegativeCents.default(0),
  bundleDiscountCents: NonNegativeCents.default(0),
  cancellationChargeCents: NonNegativeCents.default(0),
  underwritingConditions: z.array(z.string()).default([]),
  dataSource: QuoteDataSource,
  components: z.array(QuoteComponentDraft).min(1)
}).strict();

// ../schemas/src/recommendation.ts
var QuoteSnapshotSchema = z.object({
  id: z.string().uuid(),
  updated_at: z.string().datetime({ offset: true }),
  version: z.number().int().nonnegative(),
  is_incumbent: z.boolean()
}).strict();
var CanonicalComponentSnapshotSchema = z.object({
  id: z.string().uuid(),
  productLine: z.enum(["auto", "property"]),
  assetId: z.string().uuid(),
  annualPremiumCents: z.number().int().nonnegative()
}).strict();
var CanonicalInsurerMetadataSnapshotSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  financialStrengthRating: z.string(),
  paymentFrequencies: z.array(z.string()),
  billingMethods: z.array(z.string()),
  distribution: z.string()
}).strict();
var CanonicalReasonDetailSchema = z.object({
  scope: z.string(),
  quoteId: z.string().uuid().optional(),
  componentId: z.string().uuid().optional(),
  assetId: z.string().uuid().optional(),
  field: z.string(),
  expectedRule: z.string().optional(),
  actualValue: z.unknown().optional(),
  reasonCode: z.string()
}).strict();
var HexDigest = z.string().regex(/^[0-9a-f]{64}$/, "Expected a 64-character lowercase hex SHA-256 digest");
var RankingFactorsSchema = z.object({
  total_cents: z.number().int().nonnegative(),
  coverage_reductions_count: z.number().int().nonnegative(),
  deductible_total_cents: z.number().int().nonnegative(),
  underwriting_condition_count: z.number().int().nonnegative(),
  preference_missed_count: z.number().int().nonnegative(),
  preference_unknown_count: z.number().int().nonnegative()
});
var PreferenceAlignmentSchema = z.object({
  satisfied_count: z.number().int().nonnegative(),
  missed_count: z.number().int().nonnegative(),
  not_evaluable_count: z.number().int().nonnegative(),
  details: z.array(
    z.object({
      scope: z.string(),
      item: z.string(),
      outcome: z.enum(["satisfied", "missed", "unknown", "not_applicable"])
    })
  )
});
var PersistedRecommendationOptionSchema = z.object({
  rank: z.number().int().positive(),
  auto_quote_id: z.string().uuid(),
  property_quote_id: z.string().uuid(),
  auto_component_id: z.string().uuid(),
  property_component_id: z.string().uuid(),
  auto_asset_id: z.string().uuid(),
  property_asset_id: z.string().uuid(),
  bundled: z.boolean(),
  total_cents: z.number().int().nonnegative(),
  net_savings_cents: z.number().int(),
  eligible: z.boolean(),
  reason_codes: z.array(z.string()),
  ranking_factors: RankingFactorsSchema,
  preference_alignment: PreferenceAlignmentSchema,
  deductible_total_cents: z.number().int().nonnegative(),
  underwriting_condition_count: z.number().int().nonnegative()
}).strict();
var CanonicalQuoteSnapshot = EngineQuote.strict();
var CanonicalRecommendationInputSnapshotSchema = z.object({
  caseId: z.string().uuid(),
  householdId: z.string().uuid(),
  mandateId: z.string().uuid(),
  mandateVersion: z.number().int().positive(),
  mandateSchemaVersion: z.literal(2),
  jurisdiction: z.literal("AB"),
  switchingPreferencesId: z.string().uuid(),
  switchingPreferencesVersion: z.number().int().positive(),
  assets: z.object({
    vehicles: z.array(z.object({ id: z.string().uuid() }).strict()),
    properties: z.array(z.object({ id: z.string().uuid() }).strict())
  }).strict(),
  quotes: z.array(CanonicalQuoteSnapshot).min(1),
  quoteSnapshot: z.array(QuoteSnapshotSchema).min(1),
  mandate: HouseholdCoverageMandateV2,
  switching: SwitchingPreferencesV2,
  engineVersion: z.string(),
  engineSourceHash: HexDigest
}).strict();
var CanonicalEngineOutputSchema = z.object({
  incumbentTotalCents: z.number().int().nonnegative(),
  recommendedOption: PersistedRecommendationOptionSchema,
  rankedOptions: z.array(PersistedRecommendationOptionSchema).min(1),
  rejectedOptions: z.array(PersistedRecommendationOptionSchema).default([])
}).strict();
var EngineRecommendationPersistencePayloadSchema = z.object({
  caseId: z.string().uuid(),
  actorProfileId: z.string().uuid(),
  mandate: z.object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
    schemaVersion: z.literal(2),
    jurisdiction: z.literal("AB")
  }).strict(),
  switchingPreferences: z.object({
    id: z.string().uuid(),
    version: z.number().int().positive()
  }).strict(),
  engine: z.object({
    version: z.string().min(1),
    sourceHash: HexDigest
  }).strict(),
  inputSnapshotJson: CanonicalRecommendationInputSnapshotSchema,
  inputSnapshotDigest: HexDigest,
  inputSnapshotCanonical: z.string().min(1),
  recommendedOption: PersistedRecommendationOptionSchema,
  rankedOptions: z.array(PersistedRecommendationOptionSchema).min(1),
  rejectedOptions: z.array(PersistedRecommendationOptionSchema).default([]),
  engineOutputJson: CanonicalEngineOutputSchema,
  engineOutputDigest: HexDigest,
  engineOutputCanonical: z.string().min(1),
  currentTotalCents: z.number().int().nonnegative(),
  proposedTotalCents: z.number().int().nonnegative(),
  netSavingsCents: z.number().int(),
  reasonCodes: z.array(z.string()),
  comparison: z.record(z.unknown()),
  disclosureVersion: z.string().default("v1")
}).strict();

// ../schemas/src/entities.ts
var uuid = z.string().uuid();
var timestamptz = z.string();
var Profile = z.object({
  id: uuid,
  role: UserRole,
  full_name: z.string(),
  email: z.string().email(),
  created_at: timestamptz,
  updated_at: timestamptz
});
var Household = z.object({
  id: uuid,
  owner_profile_id: uuid,
  name: z.string(),
  province: z.string().length(2),
  timezone: z.string().default("America/Edmonton"),
  autopilot_active: z.boolean(),
  created_at: timestamptz,
  updated_at: timestamptz
});
var Driver = z.object({
  id: uuid,
  household_id: uuid,
  full_name: z.string(),
  date_of_birth: z.string(),
  licence_class: z.string(),
  years_licensed: z.number().int().nonnegative(),
  created_at: timestamptz,
  updated_at: timestamptz
});
var Vehicle = z.object({
  id: uuid,
  household_id: uuid,
  year: z.number().int(),
  make: z.string(),
  model: z.string(),
  vin: z.string().nullable(),
  annual_km: z.number().int().nonnegative().nullable(),
  primary_use: z.string(),
  created_at: timestamptz,
  updated_at: timestamptz
});
var Property = z.object({
  id: uuid,
  household_id: uuid,
  address_line1: z.string(),
  city: z.string(),
  province: z.string().length(2),
  postal_code: z.string(),
  year_built: z.number().int().nullable(),
  dwelling_type: z.string(),
  owner_occupied: z.boolean(),
  created_at: timestamptz,
  updated_at: timestamptz
});
var Policy = z.object({
  id: uuid,
  household_id: uuid,
  insurer_id: uuid.nullable(),
  insurer_name: z.string(),
  product_line: ProductLine,
  policy_number: z.string().nullable(),
  annual_premium_cents: NonNegativeCents,
  bundle_discount_cents: NonNegativeCents,
  renewal_date: z.string(),
  is_current: z.boolean(),
  created_at: timestamptz,
  updated_at: timestamptz
});
var PolicyDocument = z.object({
  id: uuid,
  household_id: uuid,
  policy_id: uuid.nullable(),
  category: DocumentCategory,
  status: DocumentStatus,
  storage_path: z.string(),
  file_name: z.string(),
  mime_type: z.string(),
  size_bytes: z.number().int().nonnegative(),
  uploaded_by: uuid,
  created_at: timestamptz,
  updated_at: timestamptz
});
var OptimizationCase = z.object({
  id: uuid,
  household_id: uuid,
  state: CaseState,
  renewal_date: z.string().nullable(),
  created_at: timestamptz,
  updated_at: timestamptz
});
var QuoteRequest = z.object({
  id: uuid,
  case_id: uuid,
  insurer_id: uuid,
  state: QuoteRequestState,
  product_lines: z.array(ProductLine),
  inclusion_reason: z.string(),
  created_at: timestamptz,
  updated_at: timestamptz
});
var Quote = z.object({
  id: uuid,
  case_id: uuid,
  quote_request_id: uuid.nullable(),
  insurer_id: uuid,
  state: QuoteState,
  is_incumbent: z.boolean(),
  policy_fees_cents: NonNegativeCents,
  payment_fees_cents: NonNegativeCents,
  bundle_discount_cents: NonNegativeCents,
  cancellation_charge_cents: NonNegativeCents,
  underwriting_conditions: z.array(z.string()),
  expires_at: timestamptz.nullable(),
  created_at: timestamptz,
  updated_at: timestamptz
});
var CustomerQuestion = z.object({
  id: uuid,
  case_id: uuid,
  question_type: QuestionType,
  status: QuestionStatus,
  prompt: z.string(),
  options: z.array(z.string()).nullable(),
  answer: z.string().nullable(),
  answered_by: uuid.nullable(),
  answered_at: timestamptz.nullable(),
  created_at: timestamptz,
  updated_at: timestamptz
});
var Recommendation = z.object({
  id: uuid,
  case_id: uuid,
  status: RecommendationStatus,
  version: z.number().int().positive(),
  mandate_version: z.number().int().positive(),
  current_total_cents: NonNegativeCents,
  proposed_total_cents: NonNegativeCents,
  net_savings_cents: z.number().int(),
  reason_codes: z.array(z.string()),
  disclosure_version: z.string(),
  created_at: timestamptz,
  updated_at: timestamptz
});
var SwitchEvent = z.object({
  id: uuid,
  case_id: uuid,
  state: SwitchState,
  created_at: timestamptz,
  updated_at: timestamptz
});
var Consent = z.object({
  id: uuid,
  profile_id: uuid,
  consent_type: ConsentType,
  granted: z.boolean(),
  granted_at: timestamptz,
  created_at: timestamptz
});
var Subscription = z.object({
  id: uuid,
  profile_id: uuid,
  status: SubscriptionStatus,
  stripe_customer_id: z.string().nullable(),
  stripe_subscription_id: z.string().nullable(),
  current_period_end: timestamptz.nullable(),
  created_at: timestamptz,
  updated_at: timestamptz
});

// src/rule-evaluator.ts
function evaluateMonetaryRule({
  rule,
  required,
  actual,
  incumbent,
  fieldKind
}) {
  if (rule === "any") {
    return { satisfied: true, status: "satisfied" };
  }
  if (actual === null || actual === void 0) {
    return { satisfied: false, status: "unknown_actual" };
  }
  if (rule === "minimum") {
    return actual >= required ? { satisfied: true, status: "satisfied" } : { satisfied: false, status: "below_minimum" };
  }
  if (rule === "maximum") {
    return actual <= required ? { satisfied: true, status: "satisfied" } : { satisfied: false, status: "above_maximum" };
  }
  if (rule === "exact") {
    return actual === required ? { satisfied: true, status: "satisfied" } : { satisfied: false, status: "not_exact" };
  }
  if (rule === "match_current_or_better") {
    if (incumbent === null || incumbent === void 0) {
      return { satisfied: false, status: "unknown_incumbent" };
    }
    if (fieldKind === "limit") {
      return actual >= incumbent ? { satisfied: true, status: "satisfied" } : { satisfied: false, status: "below_incumbent" };
    } else {
      return actual <= incumbent ? { satisfied: true, status: "satisfied" } : { satisfied: false, status: "above_incumbent_deductible" };
    }
  }
  return { satisfied: false, status: "unknown_actual" };
}

// src/coverage-capabilities.ts
var autoFormCapabilities = {
  unknown: [],
  liability_only: ["third_party_liability"],
  collision: ["third_party_liability", "collision_damage"],
  comprehensive: ["third_party_liability", "comprehensive_perils"],
  specified_perils: ["third_party_liability", "specified_perils"],
  all_perils: [
    "third_party_liability",
    "collision_damage",
    "comprehensive_perils",
    "all_perils_extensions"
  ]
};
var propertyFormCapabilities = {
  unknown: [],
  basic: ["fire_lightning"],
  named_perils: ["fire_lightning", "named_perils"],
  broad: ["fire_lightning", "named_perils", "broad_perils"],
  comprehensive: ["fire_lightning", "named_perils", "broad_perils", "all_risks"]
};
function hasAllCapabilities(actual, required) {
  const set = new Set(actual);
  return required.every((c) => set.has(c));
}
function autoFormMeetsOrExceeds(actual, required) {
  return hasAllCapabilities(autoFormCapabilities[actual], autoFormCapabilities[required]);
}
function propertyFormMeetsOrExceeds(actual, required) {
  return hasAllCapabilities(propertyFormCapabilities[actual], propertyFormCapabilities[required]);
}

// src/preference-evaluator.ts
var settlementRank = {
  unknown: 0,
  actual_cash_value: 1,
  replacement_cost: 2,
  extended_replacement_cost: 3,
  guaranteed_replacement_cost: 4
};
function settlementMeetsOrExceeds(actual, preferred) {
  return settlementRank[actual] >= settlementRank[preferred];
}
function evaluatePreferredBoolean(scope, item, preference, actual) {
  if (preference !== "preferred") return { outcome: "not_applicable" };
  if (actual === void 0 || actual === null) {
    return { outcome: "unknown", detail: { scope, item, outcome: "unknown" } };
  }
  if (actual) {
    return { outcome: "satisfied", detail: { scope, item, outcome: "satisfied" } };
  }
  return { outcome: "missed", detail: { scope, item, outcome: "missed" } };
}
function evaluatePreferenceAlignment(input, config) {
  const details = [];
  let satisfiedCount = 0;
  let missedCount = 0;
  let notEvaluableCount = 0;
  const auto = config.auto.component.auto;
  const property = config.property.component.property;
  const autoMandate = input.mandate.auto;
  const propertyMandate = input.mandate.property;
  const switching = input.mandate.switching;
  const autoQuote = input.quotes.find((q) => q.id === config.auto.quoteId) ?? input.incumbentAuto.quote;
  const propertyQuote = input.quotes.find((q) => q.id === config.property.quoteId) ?? input.incumbentProperty.quote;
  function record(detail, outcome) {
    if (!detail) return;
    details.push(detail);
    if (outcome === "satisfied") satisfiedCount++;
    if (outcome === "missed") missedCount++;
    if (outcome === "unknown") notEvaluableCount++;
  }
  if (auto && autoMandate.coverageForm.preference === "preferred") {
    if (autoFormMeetsOrExceeds(auto.coverageForm, autoMandate.coverageForm.value)) {
      details.push({ scope: "auto", item: "coverageForm", outcome: "satisfied" });
      satisfiedCount++;
    } else {
      details.push({ scope: "auto", item: "coverageForm", outcome: "missed" });
      missedCount++;
    }
  }
  for (const [key, value] of Object.entries(autoMandate.endorsements)) {
    if (value === "preferred" && auto) {
      const field = key;
      const actual = auto[field];
      const { outcome, detail } = evaluatePreferredBoolean(
        "auto_endorsement",
        key,
        "preferred",
        actual
      );
      record(detail, outcome);
    }
  }
  if (property && propertyMandate.coverageForm.preference === "preferred") {
    if (propertyFormMeetsOrExceeds(property.coverageForm, propertyMandate.coverageForm.value)) {
      details.push({ scope: "property", item: "coverageForm", outcome: "satisfied" });
      satisfiedCount++;
    } else {
      details.push({ scope: "property", item: "coverageForm", outcome: "missed" });
      missedCount++;
    }
  }
  if (property && propertyMandate.settlementBasis.preference === "preferred") {
    if (settlementMeetsOrExceeds(property.settlementBasis, propertyMandate.settlementBasis.value)) {
      details.push({ scope: "property", item: "settlementBasis", outcome: "satisfied" });
      satisfiedCount++;
    } else {
      details.push({ scope: "property", item: "settlementBasis", outcome: "missed" });
      missedCount++;
    }
  }
  for (const name of ["sewerBackup", "overlandWater"]) {
    const requirement = propertyMandate[name];
    if (requirement.preference === "preferred" && property) {
      const included = name === "sewerBackup" ? property.sewerBackupIncluded : property.overlandWaterIncluded;
      const { outcome, detail } = evaluatePreferredBoolean(
        "property_water",
        name,
        "preferred",
        included
      );
      record(detail, outcome);
    }
  }
  for (const [key, value] of Object.entries(propertyMandate.optionalCoverages)) {
    if (value === "preferred" && property) {
      const field = key;
      const actual = property[field];
      const { outcome, detail } = evaluatePreferredBoolean(
        "property_optional",
        key,
        "preferred",
        actual
      );
      record(detail, outcome);
    }
  }
  const paymentFreq = autoQuote.paymentFrequency ?? propertyQuote.paymentFrequency;
  if (switching.preferredPaymentFrequency && paymentFreq !== void 0 && paymentFreq !== null) {
    if (paymentFreq === switching.preferredPaymentFrequency) {
      details.push({ scope: "switching", item: "paymentFrequency", outcome: "satisfied" });
      satisfiedCount++;
    } else {
      details.push({ scope: "switching", item: "paymentFrequency", outcome: "missed" });
      missedCount++;
    }
  } else if (switching.preferredPaymentFrequency) {
    details.push({ scope: "switching", item: "paymentFrequency", outcome: "unknown" });
    notEvaluableCount++;
  }
  const billingMethod = autoQuote.billingMethod ?? propertyQuote.billingMethod;
  if (switching.preferredBillingMethod && billingMethod !== void 0 && billingMethod !== null) {
    if (billingMethod === switching.preferredBillingMethod) {
      details.push({ scope: "switching", item: "billingMethod", outcome: "satisfied" });
      satisfiedCount++;
    } else {
      details.push({ scope: "switching", item: "billingMethod", outcome: "missed" });
      missedCount++;
    }
  } else if (switching.preferredBillingMethod) {
    details.push({ scope: "switching", item: "billingMethod", outcome: "unknown" });
    notEvaluableCount++;
  }
  if (switching.brokerDirectPreference && switching.brokerDirectPreference !== "indifferent") {
    const distribution = autoQuote.distributionChannel ?? propertyQuote.distributionChannel;
    if (distribution === void 0 || distribution === null) {
      details.push({ scope: "switching", item: "brokerDirectPreference", outcome: "unknown" });
      notEvaluableCount++;
    } else if (distribution === switching.brokerDirectPreference) {
      details.push({ scope: "switching", item: "brokerDirectPreference", outcome: "satisfied" });
      satisfiedCount++;
    } else {
      details.push({ scope: "switching", item: "brokerDirectPreference", outcome: "missed" });
      missedCount++;
    }
  }
  return {
    satisfied_count: satisfiedCount,
    missed_count: missedCount,
    not_evaluable_count: notEvaluableCount,
    details
  };
}

// src/engine.ts
var USABLE_QUOTE_STATES = /* @__PURE__ */ new Set(["estimate", "conditional", "bindable", "selected"]);
var financialRatingRank = {
  B_or_lower: 1,
  B_plus: 2,
  A_minus: 3,
  A: 4,
  A_plus: 5
};
var autoEndorsementMap = {
  accident_forgiveness: "accidentForgivenessIncluded",
  rental_vehicle_coverage: "rentalVehicleCoverageIncluded",
  non_owned_automobile: "nonOwnedAutomobileIncluded",
  family_protection: "familyProtectionIncluded",
  depreciation_waiver: "depreciationWaiverIncluded",
  oem_parts: "oemPartsIncluded",
  roadside_assistance: "roadsideAssistanceIncluded",
  disappearing_deductible: "disappearingDeductibleIncluded",
  glass_coverage: "glassCoverageIncluded",
  telematics: "telematicsRequired"
};
var propertyOptionalMap = {
  equipment_breakdown: "equipmentBreakdownIncluded",
  service_line: "serviceLineIncluded",
  bylaw_coverage: "bylawCoverageIncluded",
  home_systems: "homeSystemsIncluded",
  cyber: "cyberCoverageIncluded",
  scheduled_valuables: "scheduledValuablesIncluded",
  home_business: "homeBusinessIncluded",
  short_term_rental_permission: "shortTermRentalPermissionIncluded",
  claims_forgiveness: "claimsForgivenessIncluded",
  groundwater_seepage: "groundwaterIncluded",
  ice_dam: "iceDamIncluded",
  earthquake: "earthquakeIncluded"
};
var autoEndorsementReasonKey = {
  accident_forgiveness: "accident_forgiveness",
  rental_vehicle_coverage: "rental",
  non_owned_automobile: "non_owned_auto",
  family_protection: "family_protection",
  depreciation_waiver: "depreciation_waiver",
  oem_parts: "oem_parts",
  roadside_assistance: "roadside_assistance",
  disappearing_deductible: "disappearing_deductible",
  glass_coverage: "glass_coverage",
  telematics: "telematics"
};
function componentsFor(quote, line) {
  return quote.components.filter((c) => c.productLine === line);
}
function selection(quote, component) {
  return {
    quoteId: quote.id,
    insurerId: quote.insurerId,
    insurerName: quote.insurerName,
    component,
    isIncumbent: quote.isIncumbent
  };
}
function buildConfigurations(input) {
  const usable = input.quotes.filter((q) => USABLE_QUOTE_STATES.has(q.state));
  const autoOptions = [];
  const propertyOptions = [];
  for (const quote of usable) {
    for (const component of componentsFor(quote, "auto")) autoOptions.push({ quote, component });
    for (const component of componentsFor(quote, "property"))
      propertyOptions.push({ quote, component });
  }
  autoOptions.push({ quote: input.incumbentAuto.quote, component: input.incumbentAuto.component });
  propertyOptions.push({
    quote: input.incumbentProperty.quote,
    component: input.incumbentProperty.component
  });
  const configurations = [];
  const seen = /* @__PURE__ */ new Set();
  for (const auto of autoOptions) {
    for (const property of propertyOptions) {
      const id = `${auto.quote.id}:auto+${property.quote.id}:property`;
      if (seen.has(id)) continue;
      seen.add(id);
      configurations.push({
        id,
        auto: selection(auto.quote, auto.component),
        property: selection(property.quote, property.component),
        bundled: auto.quote.insurerId === property.quote.insurerId,
        isIncumbentConfiguration: auto.quote.isIncumbent && property.quote.isIncumbent
      });
    }
  }
  return configurations;
}
function quoteById(input, id) {
  if (input.incumbentAuto.quote.id === id) return input.incumbentAuto.quote;
  if (input.incumbentProperty.quote.id === id) return input.incumbentProperty.quote;
  const found = input.quotes.find((q) => q.id === id);
  if (!found) throw new Error(`Unknown quote: ${id}`);
  return found;
}
function mergeAutoMandate(base, override) {
  if (!override) return base;
  return {
    ...base,
    ...override,
    coverageForm: override.coverageForm ? { ...base.coverageForm, ...override.coverageForm } : base.coverageForm,
    liability: override.liability ? { ...base.liability, ...override.liability } : base.liability,
    collisionDeductible: override.collisionDeductible ? { ...base.collisionDeductible, ...override.collisionDeductible } : base.collisionDeductible,
    comprehensiveDeductible: override.comprehensiveDeductible ? { ...base.comprehensiveDeductible, ...override.comprehensiveDeductible } : base.comprehensiveDeductible,
    glassDeductible: override.glassDeductible ? { ...base.glassDeductible, ...override.glassDeductible } : base.glassDeductible,
    endorsements: override.endorsements ? { ...base.endorsements, ...override.endorsements } : base.endorsements
  };
}
function mergePropertyMandate(base, override) {
  if (!override) return base;
  return {
    ...base,
    ...override,
    coverageForm: override.coverageForm ? { ...base.coverageForm, ...override.coverageForm } : base.coverageForm,
    settlementBasis: override.settlementBasis ? { ...base.settlementBasis, ...override.settlementBasis } : base.settlementBasis,
    dwellingLimit: override.dwellingLimit ? { ...base.dwellingLimit, ...override.dwellingLimit } : base.dwellingLimit,
    contentsLimit: override.contentsLimit ? { ...base.contentsLimit, ...override.contentsLimit } : base.contentsLimit,
    detachedStructuresLimit: override.detachedStructuresLimit ? { ...base.detachedStructuresLimit, ...override.detachedStructuresLimit } : base.detachedStructuresLimit,
    personalLiabilityLimit: override.personalLiabilityLimit ? { ...base.personalLiabilityLimit, ...override.personalLiabilityLimit } : base.personalLiabilityLimit,
    additionalLivingExpenseLimit: override.additionalLivingExpenseLimit ? { ...base.additionalLivingExpenseLimit, ...override.additionalLivingExpenseLimit } : base.additionalLivingExpenseLimit,
    baseDeductible: override.baseDeductible ? { ...base.baseDeductible, ...override.baseDeductible } : base.baseDeductible,
    waterDeductible: override.waterDeductible ? { ...base.waterDeductible, ...override.waterDeductible } : base.waterDeductible,
    windHailDeductible: override.windHailDeductible ? { ...base.windHailDeductible, ...override.windHailDeductible } : base.windHailDeductible,
    earthquakeDeductible: override.earthquakeDeductible ? { ...base.earthquakeDeductible, ...override.earthquakeDeductible } : base.earthquakeDeductible,
    sewerBackup: override.sewerBackup ? { ...base.sewerBackup, ...override.sewerBackup } : base.sewerBackup,
    overlandWater: override.overlandWater ? { ...base.overlandWater, ...override.overlandWater } : base.overlandWater,
    optionalCoverages: override.optionalCoverages ? { ...base.optionalCoverages, ...override.optionalCoverages } : base.optionalCoverages
  };
}
function effectiveAutoMandate(mandate, component) {
  const override = component.assetId ? mandate.vehicleOverrides[component.assetId] : void 0;
  return mergeAutoMandate(mandate.auto, override);
}
function effectivePropertyMandate(mandate, component) {
  const override = component.assetId ? mandate.propertyOverrides[component.assetId] : void 0;
  return mergePropertyMandate(mandate.property, override);
}
function computeCost(input, config) {
  const autoQuote = quoteById(input, config.auto.quoteId);
  const propertyQuote = quoteById(input, config.property.quoteId);
  const autoPremiumCents = config.auto.component.annualPremiumCents;
  const propertyPremiumCents = config.property.component.annualPremiumCents;
  const distinctQuotes = autoQuote.id === propertyQuote.id ? [autoQuote] : [autoQuote, propertyQuote];
  let policyFeesCents = 0;
  let paymentFeesCents = 0;
  let cancellationChargesCents = 0;
  for (const q of distinctQuotes) {
    policyFeesCents += q.policyFeesCents;
    paymentFeesCents += q.paymentFeesCents;
    if (!q.isIncumbent) cancellationChargesCents += q.cancellationChargeCents;
  }
  let bundleDiscountCents = 0;
  if (config.bundled) {
    bundleDiscountCents = Math.max(...distinctQuotes.map((q) => q.bundleDiscountCents));
  }
  const totalCents = autoPremiumCents + propertyPremiumCents + policyFeesCents + paymentFeesCents + cancellationChargesCents - bundleDiscountCents;
  return {
    autoPremiumCents,
    propertyPremiumCents,
    policyFeesCents,
    paymentFeesCents,
    bundleDiscountCents,
    cancellationChargesCents,
    totalCents
  };
}
function pushLimitViolations(result, reasonCodes, belowMinimum, exceedsMaximum, notExact, unknown) {
  switch (result.status) {
    case "below_minimum":
      reasonCodes.push(belowMinimum);
      break;
    case "above_maximum":
      reasonCodes.push(exceedsMaximum);
      break;
    case "not_exact":
      reasonCodes.push(notExact);
      break;
    case "unknown_actual":
    case "unknown_incumbent":
      reasonCodes.push(unknown);
      break;
    case "satisfied":
    case "below_incumbent":
    case "above_incumbent_deductible":
      break;
  }
}
function pushDeductibleViolations(result, reasonCodes, tooHigh, notExact, unknown) {
  switch (result.status) {
    case "above_maximum":
    case "above_incumbent_deductible":
      reasonCodes.push(tooHigh);
      break;
    case "not_exact":
      reasonCodes.push(notExact);
      break;
    case "unknown_actual":
    case "unknown_incumbent":
      reasonCodes.push(unknown);
      break;
    case "satisfied":
    case "below_minimum":
    case "below_incumbent":
      break;
  }
}
function pushWaterLimitViolations(result, reasonCodes, belowMinimum, exceedsMaximum, notExact, unknown) {
  pushLimitViolations(result, reasonCodes, belowMinimum, exceedsMaximum, notExact, unknown);
}
function pushWaterDeductibleViolations(result, reasonCodes, tooHigh, notExact, unknown) {
  pushDeductibleViolations(result, reasonCodes, tooHigh, notExact, unknown);
}
var settlementRank2 = {
  unknown: 0,
  actual_cash_value: 1,
  replacement_cost: 2,
  extended_replacement_cost: 3,
  guaranteed_replacement_cost: 4
};
function settlementMeetsOrExceeds2(actual, required) {
  return settlementRank2[actual] >= settlementRank2[required];
}
function autoFormSatisfies(preference, requiredForm, actualForm) {
  if (preference === "indifferent" || preference === "preferred") return true;
  if (preference === "prohibited") return actualForm !== requiredForm;
  if (preference === "required") return autoFormMeetsOrExceeds(actualForm, requiredForm);
  return true;
}
function propertyFormSatisfies(preference, requiredForm, actualForm) {
  if (preference === "indifferent" || preference === "preferred") return true;
  if (preference === "prohibited") return actualForm !== requiredForm;
  if (preference === "required") return propertyFormMeetsOrExceeds(actualForm, requiredForm);
  return true;
}
function settlementSatisfies(preference, requiredSettlement, actualSettlement) {
  if (preference === "indifferent" || preference === "preferred") return true;
  if (preference === "prohibited") return actualSettlement !== requiredSettlement;
  if (preference === "required")
    return settlementMeetsOrExceeds2(actualSettlement, requiredSettlement);
  return true;
}
function checkAutoHardRequirements(mandate, auto, incumbent) {
  const violations = [];
  const liability = evaluateMonetaryRule({
    rule: mandate.liability.rule,
    required: mandate.liability.cents,
    actual: auto.thirdPartyLiabilityCents,
    incumbent: incumbent?.thirdPartyLiabilityCents,
    fieldKind: "limit"
  });
  pushLimitViolations(
    liability,
    violations,
    "AUTO_LIABILITY_BELOW_MINIMUM",
    "AUTO_LIABILITY_EXCEEDS_MAXIMUM",
    "AUTO_LIABILITY_NOT_EXACT",
    "AUTO_LIABILITY_UNKNOWN"
  );
  if (!autoFormSatisfies(
    mandate.coverageForm.preference,
    mandate.coverageForm.value,
    auto.coverageForm
  ))
    violations.push(
      mandate.coverageForm.preference === "prohibited" ? "AUTO_COVERAGE_FORM_PROHIBITED" : "AUTO_COVERAGE_FORM_INSUFFICIENT"
    );
  if (mandate.vehicleClass && auto.vehicleClass !== mandate.vehicleClass)
    violations.push("AUTO_VEHICLE_CLASS_MISMATCH");
  if (mandate.financingStatus && auto.financingStatus !== mandate.financingStatus)
    violations.push("AUTO_FINANCING_STATUS_MISMATCH");
  if (auto.collisionIncluded) {
    const collisionDed = evaluateMonetaryRule({
      rule: mandate.collisionDeductible.rule,
      required: mandate.collisionDeductible.cents,
      actual: auto.collisionDeductibleCents,
      incumbent: incumbent?.collisionDeductibleCents,
      fieldKind: "deductible"
    });
    pushDeductibleViolations(
      collisionDed,
      violations,
      "AUTO_COLLISION_DEDUCTIBLE_TOO_HIGH",
      "AUTO_COLLISION_DEDUCTIBLE_NOT_EXACT",
      "AUTO_COLLISION_DEDUCTIBLE_UNKNOWN"
    );
  }
  if (auto.comprehensiveIncluded) {
    const comprehensiveDed = evaluateMonetaryRule({
      rule: mandate.comprehensiveDeductible.rule,
      required: mandate.comprehensiveDeductible.cents,
      actual: auto.comprehensiveDeductibleCents,
      incumbent: incumbent?.comprehensiveDeductibleCents,
      fieldKind: "deductible"
    });
    pushDeductibleViolations(
      comprehensiveDed,
      violations,
      "AUTO_COMPREHENSIVE_DEDUCTIBLE_TOO_HIGH",
      "AUTO_COMPREHENSIVE_DEDUCTIBLE_NOT_EXACT",
      "AUTO_COMPREHENSIVE_DEDUCTIBLE_UNKNOWN"
    );
  }
  const hasGlassCoverage = auto.glassCoverageIncluded || auto.glassDeductibleCents !== null;
  if (hasGlassCoverage) {
    const glassDed = evaluateMonetaryRule({
      rule: mandate.glassDeductible.rule,
      required: mandate.glassDeductible.cents,
      actual: auto.glassDeductibleCents,
      incumbent: void 0,
      fieldKind: "deductible"
    });
    pushDeductibleViolations(
      glassDed,
      violations,
      "AUTO_GLASS_DEDUCTIBLE_TOO_HIGH",
      "AUTO_GLASS_DEDUCTIBLE_NOT_EXACT",
      "AUTO_GLASS_DEDUCTIBLE_UNKNOWN"
    );
  }
  const telematicsPreference = mandate.endorsements.telematics;
  if (telematicsPreference === "required" && !auto.telematicsRequired)
    violations.push("AUTO_TELEMATICS_REQUIRED");
  if (telematicsPreference === "prohibited" && auto.telematicsRequired)
    violations.push("AUTO_TELEMATICS_PROHIBITED");
  for (const [key, field] of Object.entries(autoEndorsementMap)) {
    if (key === "telematics") continue;
    const preference = mandate.endorsements[key];
    if (!preference || preference === "indifferent" || preference === "preferred") continue;
    const value = Boolean(auto[field]);
    if (preference === "required" && !value) violations.push("AUTO_ENDORSEMENT_MISSING");
    if (preference === "prohibited" && value) violations.push("AUTO_ENDORSEMENT_PROHIBITED");
  }
  return violations;
}
function checkWaterCoverage(name, requirement, actual, incumbent) {
  const violations = [];
  const isSewer = name === "sewerBackup";
  const included = isSewer ? actual.sewerBackupIncluded : actual.overlandWaterIncluded;
  const limit = isSewer ? actual.sewerBackupLimitCents : actual.overlandWaterLimitCents;
  const deductible = isSewer ? actual.sewerBackupDeductibleCents : actual.overlandWaterDeductibleCents;
  const incumbentLimit = isSewer ? incumbent?.sewerBackupLimitCents : incumbent?.overlandWaterLimitCents;
  const incumbentDeductible = isSewer ? incumbent?.sewerBackupDeductibleCents : incumbent?.overlandWaterDeductibleCents;
  if (requirement.preference === "prohibited" && included) {
    violations.push(
      isSewer ? "PROPERTY_SEWER_BACKUP_PROHIBITED" : "PROPERTY_OVERLAND_WATER_PROHIBITED"
    );
  }
  if (requirement.preference === "required" && !included) {
    violations.push(isSewer ? "PROPERTY_SEWER_BACKUP_MISSING" : "PROPERTY_OVERLAND_WATER_MISSING");
  }
  if ((requirement.preference === "required" || requirement.preference === "preferred") && included) {
    if (limit !== null) {
      const limitCheck = evaluateMonetaryRule({
        rule: requirement.limit.rule,
        required: requirement.limit.cents,
        actual: limit,
        incumbent: incumbentLimit,
        fieldKind: "limit"
      });
      pushWaterLimitViolations(
        limitCheck,
        violations,
        isSewer ? "PROPERTY_SEWER_BACKUP_LIMIT_BELOW_MINIMUM" : "PROPERTY_OVERLAND_WATER_LIMIT_BELOW_MINIMUM",
        isSewer ? "PROPERTY_SEWER_BACKUP_LIMIT_EXCEEDS_MAXIMUM" : "PROPERTY_OVERLAND_WATER_LIMIT_EXCEEDS_MAXIMUM",
        isSewer ? "PROPERTY_SEWER_BACKUP_LIMIT_NOT_EXACT" : "PROPERTY_OVERLAND_WATER_LIMIT_NOT_EXACT",
        isSewer ? "PROPERTY_SEWER_BACKUP_LIMIT_UNKNOWN" : "PROPERTY_OVERLAND_WATER_LIMIT_UNKNOWN"
      );
    }
    if (deductible !== null) {
      const dedCheck = evaluateMonetaryRule({
        rule: requirement.deductible.rule,
        required: requirement.deductible.cents,
        actual: deductible,
        incumbent: incumbentDeductible,
        fieldKind: "deductible"
      });
      pushWaterDeductibleViolations(
        dedCheck,
        violations,
        isSewer ? "PROPERTY_SEWER_BACKUP_DEDUCTIBLE_TOO_HIGH" : "PROPERTY_OVERLAND_WATER_DEDUCTIBLE_TOO_HIGH",
        isSewer ? "PROPERTY_SEWER_BACKUP_DEDUCTIBLE_NOT_EXACT" : "PROPERTY_OVERLAND_WATER_DEDUCTIBLE_NOT_EXACT",
        isSewer ? "PROPERTY_SEWER_BACKUP_DEDUCTIBLE_UNKNOWN" : "PROPERTY_OVERLAND_WATER_DEDUCTIBLE_UNKNOWN"
      );
    }
  }
  return violations;
}
function checkPropertyHardRequirements(mandate, property, incumbent) {
  const violations = [];
  if (mandate.propertyType && mandate.propertyType !== property.propertyType)
    violations.push("PROPERTY_TYPE_MISMATCH");
  if (!propertyFormSatisfies(
    mandate.coverageForm.preference,
    mandate.coverageForm.value,
    property.coverageForm
  ))
    violations.push(
      mandate.coverageForm.preference === "prohibited" ? "PROPERTY_COVERAGE_FORM_PROHIBITED" : "PROPERTY_COVERAGE_FORM_INSUFFICIENT"
    );
  if (!settlementSatisfies(
    mandate.settlementBasis.preference,
    mandate.settlementBasis.value,
    property.settlementBasis
  ))
    violations.push(
      mandate.settlementBasis.preference === "prohibited" ? "PROPERTY_SETTLEMENT_PROHIBITED" : "PROPERTY_SETTLEMENT_BELOW_REQUIRED"
    );
  const dwelling = evaluateMonetaryRule({
    rule: mandate.dwellingLimit.rule,
    required: mandate.dwellingLimit.cents,
    actual: property.dwellingLimitCents,
    incumbent: incumbent?.dwellingLimitCents,
    fieldKind: "limit"
  });
  pushLimitViolations(
    dwelling,
    violations,
    "PROPERTY_DWELLING_LIMIT_BELOW_MINIMUM",
    "PROPERTY_DWELLING_LIMIT_EXCEEDS_MAXIMUM",
    "PROPERTY_DWELLING_LIMIT_NOT_EXACT",
    "PROPERTY_DWELLING_LIMIT_UNKNOWN"
  );
  const contents = evaluateMonetaryRule({
    rule: mandate.contentsLimit.rule,
    required: mandate.contentsLimit.cents,
    actual: property.contentsLimitCents,
    incumbent: incumbent?.contentsLimitCents,
    fieldKind: "limit"
  });
  pushLimitViolations(
    contents,
    violations,
    "PROPERTY_CONTENTS_LIMIT_BELOW_MINIMUM",
    "PROPERTY_CONTENTS_LIMIT_EXCEEDS_MAXIMUM",
    "PROPERTY_CONTENTS_LIMIT_NOT_EXACT",
    "PROPERTY_CONTENTS_LIMIT_UNKNOWN"
  );
  const detached = evaluateMonetaryRule({
    rule: mandate.detachedStructuresLimit.rule,
    required: mandate.detachedStructuresLimit.cents,
    actual: property.detachedStructuresLimitCents,
    incumbent: incumbent?.detachedStructuresLimitCents,
    fieldKind: "limit"
  });
  pushLimitViolations(
    detached,
    violations,
    "PROPERTY_DETACHED_STRUCTURES_LIMIT_BELOW_MINIMUM",
    "PROPERTY_DETACHED_STRUCTURES_LIMIT_EXCEEDS_MAXIMUM",
    "PROPERTY_DETACHED_STRUCTURES_LIMIT_NOT_EXACT",
    "PROPERTY_DETACHED_STRUCTURES_LIMIT_UNKNOWN"
  );
  const liability = evaluateMonetaryRule({
    rule: mandate.personalLiabilityLimit.rule,
    required: mandate.personalLiabilityLimit.cents,
    actual: property.personalLiabilityLimitCents,
    incumbent: incumbent?.personalLiabilityLimitCents,
    fieldKind: "limit"
  });
  pushLimitViolations(
    liability,
    violations,
    "PROPERTY_PERSONAL_LIABILITY_BELOW_MINIMUM",
    "PROPERTY_PERSONAL_LIABILITY_EXCEEDS_MAXIMUM",
    "PROPERTY_PERSONAL_LIABILITY_NOT_EXACT",
    "PROPERTY_PERSONAL_LIABILITY_UNKNOWN"
  );
  const ale = evaluateMonetaryRule({
    rule: mandate.additionalLivingExpenseLimit.rule,
    required: mandate.additionalLivingExpenseLimit.cents,
    actual: property.additionalLivingExpenseLimitCents,
    incumbent: incumbent?.additionalLivingExpenseLimitCents,
    fieldKind: "limit"
  });
  pushLimitViolations(
    ale,
    violations,
    "PROPERTY_ADDITIONAL_LIVING_EXPENSE_BELOW_MINIMUM",
    "PROPERTY_ADDITIONAL_LIVING_EXPENSE_EXCEEDS_MAXIMUM",
    "PROPERTY_ADDITIONAL_LIVING_EXPENSE_NOT_EXACT",
    "PROPERTY_ADDITIONAL_LIVING_EXPENSE_UNKNOWN"
  );
  const baseDed = evaluateMonetaryRule({
    rule: mandate.baseDeductible.rule,
    required: mandate.baseDeductible.cents,
    actual: property.baseDeductibleCents,
    incumbent: incumbent?.baseDeductibleCents,
    fieldKind: "deductible"
  });
  pushDeductibleViolations(
    baseDed,
    violations,
    "PROPERTY_BASE_DEDUCTIBLE_TOO_HIGH",
    "PROPERTY_BASE_DEDUCTIBLE_NOT_EXACT",
    "PROPERTY_BASE_DEDUCTIBLE_UNKNOWN"
  );
  const waterDed = evaluateMonetaryRule({
    rule: mandate.waterDeductible.rule,
    required: mandate.waterDeductible.cents,
    actual: property.waterDeductibleCents,
    incumbent: incumbent?.waterDeductibleCents,
    fieldKind: "deductible"
  });
  pushDeductibleViolations(
    waterDed,
    violations,
    "PROPERTY_WATER_DEDUCTIBLE_TOO_HIGH",
    "PROPERTY_WATER_DEDUCTIBLE_NOT_EXACT",
    "PROPERTY_WATER_DEDUCTIBLE_UNKNOWN"
  );
  if (property.windHailIncluded) {
    const windHailDed = evaluateMonetaryRule({
      rule: mandate.windHailDeductible.rule,
      required: mandate.windHailDeductible.cents,
      actual: property.windHailDeductibleCents,
      incumbent: incumbent?.windHailDeductibleCents,
      fieldKind: "deductible"
    });
    pushDeductibleViolations(
      windHailDed,
      violations,
      "PROPERTY_WIND_HAIL_DEDUCTIBLE_TOO_HIGH",
      "PROPERTY_WIND_HAIL_DEDUCTIBLE_NOT_EXACT",
      "PROPERTY_WIND_HAIL_DEDUCTIBLE_UNKNOWN"
    );
  }
  if (property.earthquakeIncluded) {
    const earthquakeDed = evaluateMonetaryRule({
      rule: mandate.earthquakeDeductible.rule,
      required: mandate.earthquakeDeductible.cents,
      actual: property.earthquakeDeductibleCents,
      incumbent: incumbent?.earthquakeDeductibleCents,
      fieldKind: "deductible"
    });
    pushDeductibleViolations(
      earthquakeDed,
      violations,
      "PROPERTY_EARTHQUAKE_DEDUCTIBLE_TOO_HIGH",
      "PROPERTY_EARTHQUAKE_DEDUCTIBLE_NOT_EXACT",
      "PROPERTY_EARTHQUAKE_DEDUCTIBLE_UNKNOWN"
    );
  }
  violations.push(...checkWaterCoverage("sewerBackup", mandate.sewerBackup, property, incumbent));
  violations.push(
    ...checkWaterCoverage("overlandWater", mandate.overlandWater, property, incumbent)
  );
  for (const [key, field] of Object.entries(propertyOptionalMap)) {
    const preference = mandate.optionalCoverages[key];
    if (!preference || preference === "indifferent" || preference === "preferred") continue;
    const value = Boolean(property[field]);
    if (preference === "required" && !value) violations.push("PROPERTY_OPTIONAL_COVERAGE_MISSING");
    if (preference === "prohibited" && value)
      violations.push("PROPERTY_OPTIONAL_COVERAGE_PROHIBITED");
  }
  return violations;
}
function checkHardRequirements(input, config) {
  const auto = config.auto.component.auto;
  const property = config.property.component.property;
  if (!auto || !property) return ["QUOTE_NOT_USABLE"];
  const autoMandate = effectiveAutoMandate(input.mandate, config.auto.component);
  const propertyMandate = effectivePropertyMandate(input.mandate, config.property.component);
  const incumbentAuto = input.incumbentAuto.component.auto;
  const incumbentProperty = input.incumbentProperty.component.property;
  return [
    ...checkAutoHardRequirements(autoMandate, auto, incumbentAuto),
    ...checkPropertyHardRequirements(propertyMandate, property, incumbentProperty)
  ];
}
function isCoverageReduced(actual, incumbent) {
  if (typeof actual === "boolean" && typeof incumbent === "boolean") {
    return incumbent && !actual;
  }
  if (typeof actual === "number" && typeof incumbent === "number") {
    return actual < incumbent;
  }
  return false;
}
function coverageReductionsVsIncumbent(input, config) {
  const reductions = [];
  const incumbentAuto = input.incumbentAuto.component.auto;
  const incumbentProperty = input.incumbentProperty.component.property;
  const auto = config.auto.component.auto;
  const property = config.property.component.property;
  if (!auto || !property) return ["missing_coverage_details"];
  if (auto.thirdPartyLiabilityCents < incumbentAuto.thirdPartyLiabilityCents)
    reductions.push("auto_liability_reduced");
  if (!autoFormMeetsOrExceeds(auto.coverageForm, incumbentAuto.coverageForm))
    reductions.push("auto_coverage_form_reduced");
  if (incumbentAuto.collisionIncluded && !auto.collisionIncluded)
    reductions.push("auto_collision_removed");
  if (incumbentAuto.comprehensiveIncluded && !auto.comprehensiveIncluded)
    reductions.push("auto_comprehensive_removed");
  for (const [key, field] of Object.entries(autoEndorsementMap)) {
    if (isCoverageReduced(auto[field], incumbentAuto[field])) {
      reductions.push(`auto_${autoEndorsementReasonKey[key]}_removed`);
    }
  }
  if (property.dwellingLimitCents < incumbentProperty.dwellingLimitCents)
    reductions.push("property_dwelling_limit_reduced");
  if (!propertyFormMeetsOrExceeds(property.coverageForm, incumbentProperty.coverageForm))
    reductions.push("property_coverage_form_reduced");
  if (!settlementMeetsOrExceeds2(property.settlementBasis, incumbentProperty.settlementBasis))
    reductions.push("property_settlement_reduced");
  if (property.contentsLimitCents < incumbentProperty.contentsLimitCents)
    reductions.push("property_contents_limit_reduced");
  if (property.detachedStructuresLimitCents < incumbentProperty.detachedStructuresLimitCents)
    reductions.push("property_detached_structures_limit_reduced");
  if (property.personalLiabilityLimitCents < incumbentProperty.personalLiabilityLimitCents)
    reductions.push("property_personal_liability_limit_reduced");
  if (property.additionalLivingExpenseLimitCents < incumbentProperty.additionalLivingExpenseLimitCents)
    reductions.push("property_ale_limit_reduced");
  if (isCoverageReduced(property.sewerBackupIncluded, incumbentProperty.sewerBackupIncluded))
    reductions.push("property_sewer_backup_removed");
  if (property.sewerBackupLimitCents !== null && incumbentProperty.sewerBackupLimitCents !== null && property.sewerBackupLimitCents < incumbentProperty.sewerBackupLimitCents)
    reductions.push("property_sewer_backup_limit_reduced");
  if (isCoverageReduced(property.overlandWaterIncluded, incumbentProperty.overlandWaterIncluded))
    reductions.push("property_overland_water_removed");
  if (property.overlandWaterLimitCents !== null && incumbentProperty.overlandWaterLimitCents !== null && property.overlandWaterLimitCents < incumbentProperty.overlandWaterLimitCents)
    reductions.push("property_overland_water_limit_reduced");
  for (const [key, field] of Object.entries(propertyOptionalMap)) {
    if (isCoverageReduced(property[field], incumbentProperty[field])) {
      reductions.push(`property_${key}_removed`);
    }
  }
  return reductions;
}
function numOr(v, fallback) {
  return v === null || v === void 0 ? fallback : v;
}
function deductibleIncreasedVsIncumbent(input, config) {
  const incumbentAuto = input.incumbentAuto.component.auto;
  const incumbentProperty = input.incumbentProperty.component.property;
  const auto = config.auto.component.auto;
  const property = config.property.component.property;
  if (!auto || !property) return { increased: false, increaseCents: 0 };
  let increaseCents = 0;
  if (auto.collisionIncluded && incumbentAuto.collisionIncluded) {
    const diff = numOr(auto.collisionDeductibleCents, 0) - numOr(incumbentAuto.collisionDeductibleCents, 0);
    if (diff > 0) increaseCents += diff;
  }
  if (auto.comprehensiveIncluded && incumbentAuto.comprehensiveIncluded) {
    const diff = numOr(auto.comprehensiveDeductibleCents, 0) - numOr(incumbentAuto.comprehensiveDeductibleCents, 0);
    if (diff > 0) increaseCents += diff;
  }
  if (numOr(auto.glassDeductibleCents, 0) > numOr(incumbentAuto.glassDeductibleCents, 0))
    increaseCents += numOr(auto.glassDeductibleCents, 0) - numOr(incumbentAuto.glassDeductibleCents, 0);
  if (property.baseDeductibleCents > incumbentProperty.baseDeductibleCents)
    increaseCents += property.baseDeductibleCents - incumbentProperty.baseDeductibleCents;
  if (numOr(property.waterDeductibleCents, 0) > numOr(incumbentProperty.waterDeductibleCents, 0))
    increaseCents += numOr(property.waterDeductibleCents, 0) - numOr(incumbentProperty.waterDeductibleCents, 0);
  if (property.windHailIncluded && incumbentProperty.windHailIncluded) {
    const diff = numOr(property.windHailDeductibleCents, 0) - numOr(incumbentProperty.windHailDeductibleCents, 0);
    if (diff > 0) increaseCents += diff;
  }
  if (property.earthquakeIncluded && incumbentProperty.earthquakeIncluded) {
    const diff = numOr(property.earthquakeDeductibleCents, 0) - numOr(incumbentProperty.earthquakeDeductibleCents, 0);
    if (diff > 0) increaseCents += diff;
  }
  return { increased: increaseCents > 0, increaseCents };
}
function totalDeductibles(config) {
  const auto = config.auto.component.auto;
  const property = config.property.component.property;
  let total = 0;
  if (auto) {
    total += auto.collisionIncluded ? numOr(auto.collisionDeductibleCents, 0) : 0;
    total += auto.comprehensiveIncluded ? numOr(auto.comprehensiveDeductibleCents, 0) : 0;
    total += numOr(auto.glassDeductibleCents, 0);
  }
  if (property) {
    total += property.baseDeductibleCents;
    total += numOr(property.waterDeductibleCents, 0);
    total += property.windHailIncluded ? numOr(property.windHailDeductibleCents, 0) : 0;
    total += property.earthquakeIncluded ? numOr(property.earthquakeDeductibleCents, 0) : 0;
  }
  return total;
}
function underwritingConditionCount(input, config) {
  const autoQuote = quoteById(input, config.auto.quoteId);
  const propertyQuote = quoteById(input, config.property.quoteId);
  const quotes = autoQuote.id === propertyQuote.id ? [autoQuote] : [autoQuote, propertyQuote];
  return quotes.reduce((n, q) => n + q.underwritingConditions.length, 0);
}
function validateEngineInput(input) {
  const autoIds = /* @__PURE__ */ new Set();
  const propertyIds = /* @__PURE__ */ new Set();
  const allQuotes = [...input.quotes, input.incumbentAuto.quote, input.incumbentProperty.quote];
  for (const quote of allQuotes) {
    let autoSeen = false;
    let propertySeen = false;
    for (const component of quote.components) {
      if (component.productLine === "auto") {
        if (autoSeen) {
          return {
            code: "MULTI_ASSET_OPTIMIZATION_NOT_ENABLED",
            message: "Multi-asset optimization is not enabled in this release."
          };
        }
        autoSeen = true;
        if (component.assetId) autoIds.add(component.assetId);
      }
      if (component.productLine === "property") {
        if (propertySeen) {
          return {
            code: "MULTI_ASSET_OPTIMIZATION_NOT_ENABLED",
            message: "Multi-asset optimization is not enabled in this release."
          };
        }
        propertySeen = true;
        if (component.assetId) propertyIds.add(component.assetId);
      }
    }
  }
  if (autoIds.size > 1) {
    return {
      code: "MULTI_ASSET_OPTIMIZATION_NOT_ENABLED",
      message: "Multi-asset optimization is not enabled in this release."
    };
  }
  if (propertyIds.size > 1) {
    return {
      code: "MULTI_ASSET_OPTIMIZATION_NOT_ENABLED",
      message: "Multi-asset optimization is not enabled in this release."
    };
  }
  if (input.assets) {
    const vehicleIdSet = new Set(input.assets.vehicles.map((v) => v.id));
    const propertyIdSet = new Set(input.assets.properties.map((p) => p.id));
    for (const id of autoIds) {
      if (id && !vehicleIdSet.has(id)) {
        return {
          code: "MISSING_INSURED_ASSET",
          message: `Auto component references unknown vehicle ${id}`
        };
      }
    }
    for (const id of propertyIds) {
      if (id && !propertyIdSet.has(id)) {
        return {
          code: "MISSING_INSURED_ASSET",
          message: `Property component references unknown property ${id}`
        };
      }
    }
    for (const vehicle of input.assets.vehicles) {
      if (![...autoIds].some((id) => id === vehicle.id)) {
        return {
          code: "MISSING_INSURED_ASSET",
          message: `No auto component matches the insured vehicle ${vehicle.id}`
        };
      }
    }
    for (const property of input.assets.properties) {
      if (![...propertyIds].some((id) => id === property.id)) {
        return {
          code: "MISSING_INSURED_ASSET",
          message: `No property component matches the insured property ${property.id}`
        };
      }
    }
    for (const key of Object.keys(input.mandate.vehicleOverrides)) {
      if (!vehicleIdSet.has(key)) {
        return {
          code: "MISSING_INSURED_ASSET",
          message: `Vehicle override without matching asset ${key}`
        };
      }
    }
    for (const key of Object.keys(input.mandate.propertyOverrides)) {
      if (!propertyIdSet.has(key)) {
        return {
          code: "MISSING_INSURED_ASSET",
          message: `Property override without matching property ${key}`
        };
      }
    }
  }
  return null;
}
function evaluateHousehold(input) {
  const validation = validateEngineInput(input);
  if (validation) {
    return {
      incumbentTotalCents: 0,
      evaluated: [],
      eligible: [],
      recommended: null,
      rejection: validation
    };
  }
  const mandate = input.mandate;
  const configurations = buildConfigurations(input);
  const incumbentConfig = configurations.find((c) => c.isIncumbentConfiguration);
  if (!incumbentConfig) throw new Error("Incumbent configuration missing");
  const incumbentTotalCents = computeCost(input, incumbentConfig).totalCents;
  const evaluated = configurations.map((config) => {
    const cost = computeCost(input, config);
    const netSavingsCents = incumbentTotalCents - cost.totalCents;
    const reasonCodes = [];
    let eligible = true;
    reasonCodes.push(
      config.isIncumbentConfiguration ? "INCUMBENT_CONFIGURATION" : config.bundled ? "BUNDLED_CONFIGURATION" : "SPLIT_CONFIGURATION"
    );
    if (!config.bundled && !mandate.switching.splitInsurersAllowed) {
      eligible = false;
      reasonCodes.push("SPLIT_INSURERS_PROHIBITED");
    }
    const incumbentBundled = input.incumbentAuto.quote.insurerId === input.incumbentProperty.quote.insurerId;
    if (!config.isIncumbentConfiguration && !mandate.switching.allowBundleBreakup && incumbentBundled && !config.bundled) {
      eligible = false;
      reasonCodes.push("BUNDLE_BREAKUP_PROHIBITED");
    }
    const excluded = new Set(mandate.switching.excludedInsurerIds);
    if (!config.isIncumbentConfiguration && (excluded.has(config.auto.insurerId) || excluded.has(config.property.insurerId))) {
      eligible = false;
      reasonCodes.push("EXCLUDED_INSURER");
    }
    const autoQuote = quoteById(input, config.auto.quoteId);
    const propertyQuote = quoteById(input, config.property.quoteId);
    if (mandate.switching.minimumInsurerFinancialRating !== "any" && mandate.switching.minimumInsurerFinancialRating !== void 0) {
      const requiredRank = financialRatingRank[mandate.switching.minimumInsurerFinancialRating];
      if (requiredRank !== void 0) {
        for (const q of [autoQuote, propertyQuote]) {
          const quoteRating = q.insurerFinancialRating;
          if (quoteRating === void 0 || financialRatingRank[quoteRating] === void 0) {
            eligible = false;
            reasonCodes.push("INSURER_RATING_UNKNOWN");
            break;
          }
          if (financialRatingRank[quoteRating] < requiredRank) {
            eligible = false;
            reasonCodes.push("INSURER_RATING_BELOW_MINIMUM");
            break;
          }
        }
      }
    }
    const violations = checkHardRequirements(input, config);
    if (violations.length > 0) {
      eligible = false;
      reasonCodes.push(...violations);
    } else {
      reasonCodes.push("MEETS_ALL_HARD_REQUIREMENTS");
    }
    const coverageReductions = config.isIncumbentConfiguration ? [] : coverageReductionsVsIncumbent(input, config);
    if (!config.isIncumbentConfiguration && coverageReductions.length > 0) {
      eligible = false;
      reasonCodes.push("COVERAGE_REDUCTION_VS_INCUMBENT");
    }
    const deductibleIncrease = deductibleIncreasedVsIncumbent(input, config);
    if (!config.isIncumbentConfiguration) {
      const allowedDeductibleIncreaseCents = mandate.switching.deductibleIncreasesAllowed ? mandate.switching.maxDeductibleIncreaseCents ?? Number.MAX_SAFE_INTEGER : 0;
      if (deductibleIncrease.increaseCents > allowedDeductibleIncreaseCents) {
        eligible = false;
        reasonCodes.push("DEDUCTIBLE_INCREASE_PROHIBITED");
      }
    }
    if (!config.isIncumbentConfiguration) {
      const premiumIncreaseCents = Math.max(0, cost.totalCents - incumbentTotalCents);
      const allowedPremiumIncreaseCents = mandate.switching.maxPremiumIncreaseCents ?? 0;
      if (premiumIncreaseCents > allowedPremiumIncreaseCents) {
        eligible = false;
        reasonCodes.push("PREMIUM_INCREASE_TOO_HIGH");
      }
    }
    if (!config.isIncumbentConfiguration) {
      if (netSavingsCents < mandate.switching.minNetAnnualSavingsCents) {
        eligible = false;
        reasonCodes.push("BELOW_SAVINGS_THRESHOLD");
      } else if (eligible) {
        reasonCodes.push("MEETS_SAVINGS_THRESHOLD");
      }
    }
    const preferenceAlignment = evaluatePreferenceAlignment(input, config);
    return {
      configuration: config,
      cost,
      netSavingsCents,
      eligible,
      reasonCodes,
      coverageReductions,
      deductibleTotalCents: totalDeductibles(config),
      underwritingConditionCount: underwritingConditionCount(input, config),
      preferenceAlignment
    };
  });
  const eligibleConfigs = evaluated.filter((e) => e.eligible && !e.configuration.isIncumbentConfiguration).sort(rankConfigurations);
  return {
    incumbentTotalCents,
    evaluated,
    eligible: eligibleConfigs,
    recommended: eligibleConfigs[0] ?? null
  };
}
function rankConfigurations(a, b) {
  if (a.cost.totalCents !== b.cost.totalCents) return a.cost.totalCents - b.cost.totalCents;
  const aMissed = a.preferenceAlignment.missed_count;
  const bMissed = b.preferenceAlignment.missed_count;
  if (aMissed !== bMissed) return aMissed - bMissed;
  const aUnknown = a.preferenceAlignment.not_evaluable_count;
  const bUnknown = b.preferenceAlignment.not_evaluable_count;
  if (aUnknown !== bUnknown) return aUnknown - bUnknown;
  if (a.coverageReductions.length !== b.coverageReductions.length)
    return a.coverageReductions.length - b.coverageReductions.length;
  if (a.deductibleTotalCents !== b.deductibleTotalCents)
    return a.deductibleTotalCents - b.deductibleTotalCents;
  if (a.underwritingConditionCount !== b.underwritingConditionCount)
    return a.underwritingConditionCount - b.underwritingConditionCount;
  return a.configuration.id.localeCompare(b.configuration.id);
}

// src/input-from-snapshot.ts
function collectValidationIssues(basePath, issues) {
  return issues.map((issue) => `${basePath}.${issue.path.join(".")}: ${issue.message}`).join("; ");
}
function validateMandateAndSwitching(mandate, switching) {
  const mandateResult = HouseholdCoverageMandateV2.safeParse(mandate);
  if (!mandateResult.success) {
    return {
      code: "INVALID_MANDATE",
      message: `Mandate validation failed: ${collectValidationIssues("mandate", mandateResult.error.issues)}`
    };
  }
  const switchingResult = SwitchingPreferencesV2.safeParse(switching);
  if (!switchingResult.success) {
    return {
      code: "INVALID_SWITCHING_PREFERENCES",
      message: `Switching preferences validation failed: ${collectValidationIssues("switching", switchingResult.error.issues)}`
    };
  }
  return null;
}
function quoteValidationErrorMessage(component) {
  if (!component.validationErrors || component.validationErrors.length === 0)
    return "validation failed";
  return component.validationErrors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
}
function validateQuoteCoverage(component) {
  if (component.validationStatus !== "valid") {
    return {
      code: "QUOTE_NOT_USABLE",
      message: `Quote component is ${component.validationStatus}: ${quoteValidationErrorMessage(component)}`,
      details: { componentId: component.id }
    };
  }
  if (component.productLine === "auto") {
    if (component.auto === null) {
      return {
        code: "QUOTE_NOT_USABLE",
        message: "Auto component is missing auto coverage",
        details: { componentId: component.id }
      };
    }
    const result = AutoCoverageDetails.safeParse(component.auto);
    if (!result.success) {
      return {
        code: "QUOTE_NOT_USABLE",
        message: `Auto coverage validation failed: ${collectValidationIssues("auto", result.error.issues)}`,
        details: { componentId: component.id }
      };
    }
    return null;
  }
  if (component.productLine === "property") {
    if (component.property === null) {
      return {
        code: "QUOTE_NOT_USABLE",
        message: "Property component is missing property coverage",
        details: { componentId: component.id }
      };
    }
    const result = PropertyCoverageDetails.safeParse(component.property);
    if (!result.success) {
      return {
        code: "QUOTE_NOT_USABLE",
        message: `Property coverage validation failed: ${collectValidationIssues("property", result.error.issues)}`,
        details: { componentId: component.id }
      };
    }
    return null;
  }
  return {
    code: "QUOTE_NOT_USABLE",
    message: `Unknown product line: ${component.productLine}`,
    details: { componentId: component.id }
  };
}
function buildEngineInputFromSnapshot(snapshot) {
  const validation = validateMandateAndSwitching(snapshot.mandate, snapshot.switching);
  if (validation) return validation;
  const validatedMandate = HouseholdCoverageMandateV2.parse(snapshot.mandate);
  const validatedSwitching = SwitchingPreferencesV2.parse(snapshot.switching);
  const validatedQuotes = [];
  for (const raw of snapshot.quotes) {
    const quoteResult = EngineQuote.safeParse(raw);
    if (!quoteResult.success) {
      const quoteId = typeof raw === "object" && raw !== null && "id" in raw ? String(raw.id) : void 0;
      return {
        code: "QUOTE_NOT_USABLE",
        message: `Quote validation failed: ${collectValidationIssues("quote", quoteResult.error.issues)}`,
        details: { quoteId }
      };
    }
    const quote = quoteResult.data;
    for (const component of quote.components) {
      const componentError = validateQuoteCoverage(component);
      if (componentError) return componentError;
    }
    validatedQuotes.push(quote);
  }
  const incumbentQuote = validatedQuotes.find((q) => q.isIncumbent);
  if (!incumbentQuote) {
    return { code: "QUOTE_NOT_USABLE", message: "No incumbent quote found in the case" };
  }
  const incumbentAutoComponent = incumbentQuote.components.find(
    (c) => c.productLine === "auto" && c.auto !== null
  );
  const incumbentPropertyComponent = incumbentQuote.components.find(
    (c) => c.productLine === "property" && c.property !== null
  );
  if (!incumbentAutoComponent) {
    return {
      code: "QUOTE_NOT_USABLE",
      message: "Incumbent quote is missing an auto component",
      details: { quoteId: incumbentQuote.id }
    };
  }
  if (!incumbentPropertyComponent) {
    return {
      code: "QUOTE_NOT_USABLE",
      message: "Incumbent quote is missing a property component",
      details: { quoteId: incumbentQuote.id }
    };
  }
  const engineMandate = mandateV2ToEngineMandate(validatedMandate, validatedSwitching);
  const input = {
    mandate: engineMandate,
    quotes: validatedQuotes,
    incumbentAuto: { quote: incumbentQuote, component: incumbentAutoComponent },
    incumbentProperty: { quote: incumbentQuote, component: incumbentPropertyComponent },
    assets: snapshot.assets
  };
  const engineValidation = validateEngineInput(input);
  if (engineValidation) {
    return {
      code: engineValidation.code,
      message: engineValidation.message
    };
  }
  return input;
}

// src/canonical.ts
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function sortPrimitives(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}
function isRecordArray(value) {
  return value.length > 0 && value.every((x) => isPlainObject(x));
}
function sortByKey(items, key) {
  return [...items].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
}
function sortByPath(items) {
  return [...items].sort((a, b) => JSON.stringify(a.path).localeCompare(JSON.stringify(b.path)));
}
function sortByRank(items) {
  return [...items].sort((a, b) => a.rank - b.rank);
}
function canonicalizeForDigest(value) {
  if (value === void 0) return void 0;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const canonicalized = value.map(canonicalizeForDigest).filter((x) => x !== void 0);
    if (canonicalized.length === 0) return [];
    if (isRecordArray(canonicalized)) {
      const first2 = canonicalized[0];
      if ("rank" in first2) {
        return sortByRank(canonicalized).map(
          canonicalizeForDigest
        );
      }
      if ("id" in first2) {
        return sortByKey(canonicalized, "id").map(canonicalizeForDigest);
      }
      if ("path" in first2) {
        return sortByPath(
          canonicalized
        ).map(canonicalizeForDigest);
      }
      if ("scope" in first2 && "item" in first2) {
        return [...canonicalized].sort((a, b) => {
          const scopeA = String(a.scope);
          const scopeB = String(b.scope);
          if (scopeA !== scopeB) return scopeA.localeCompare(scopeB);
          return String(a.item).localeCompare(String(b.item));
        }).map(canonicalizeForDigest);
      }
    }
    if (canonicalized.every(
      (x) => typeof x === "string" || typeof x === "number" || typeof x === "boolean" || x === null
    )) {
      return [...canonicalized].sort(sortPrimitives);
    }
    return canonicalized;
  }
  const obj = value;
  const sorted = {};
  for (const key of Object.keys(obj).sort()) {
    if (key === "generatedAt") continue;
    const child = canonicalizeForDigest(obj[key]);
    if (child !== void 0) {
      sorted[key] = child;
    }
  }
  return sorted;
}
function canonicalSerializeRecommendationInput(snapshot, engineVersion, engineSourceHash) {
  const canonical = canonicalizeForDigest({
    ...snapshot,
    engineVersion,
    engineSourceHash
  });
  return { canonical, canonicalJson: JSON.stringify(canonical) };
}
function canonicalSerializeRecommendationOutput(result, recommendedOption, rankedOptions, rejectedOptions) {
  const canonical = canonicalizeForDigest({
    incumbentTotalCents: result.incumbentTotalCents,
    recommendedOption,
    rankedOptions,
    rejectedOptions
  });
  return { canonical, canonicalJson: JSON.stringify(canonical) };
}

// ../database/src/mandate-repository.ts
var MandateLoadError = class extends Error {
  constructor(message, operation, resource, code) {
    super(message);
    this.operation = operation;
    this.resource = resource;
    this.code = code;
    this.name = "MandateLoadError";
  }
  operation;
  resource;
  code;
};
var MandateValidationError = class extends Error {
  constructor(message, issues) {
    super(message);
    this.issues = issues;
    this.name = "MandateValidationError";
  }
  issues;
};
function isNoRowsError(error) {
  return error.code === "PGRST116";
}
function throwIfError(error, operation, resource) {
  if (!error) return;
  throw new MandateLoadError(
    `Database error during ${operation} on ${resource}: ${error.message}`,
    operation,
    resource,
    error.code ?? "UNKNOWN"
  );
}
function canonicalizeStoredMonetaryRules(value) {
  if (value === null || value === void 0) return value;
  if (Array.isArray(value)) {
    return value.map(canonicalizeStoredMonetaryRules);
  }
  if (typeof value === "object") {
    const obj = value;
    if (typeof obj.rule === "string") {
      const out2 = { rule: obj.rule };
      if (obj.rule === "minimum" || obj.rule === "maximum" || obj.rule === "exact") {
        if (obj.amountCents !== void 0) {
          out2.amountCents = obj.amountCents;
        } else if (obj.cents !== void 0) {
          out2.amountCents = obj.cents;
        }
      }
      return out2;
    }
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = canonicalizeStoredMonetaryRules(v);
    }
    return out;
  }
  return value;
}
function validateMandate(mandate) {
  const parsed = HouseholdCoverageMandateV2.safeParse(mandate);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path,
      message: issue.message
    }));
    throw new MandateValidationError("Stored mandate is invalid", issues);
  }
  return parsed.data;
}
async function loadSwitching(supabase, householdId) {
  const { data, error } = await supabase.from("switching_preferences").select("*").eq("household_id", householdId).eq("is_current", true).order("version", { ascending: false }).limit(1).single();
  if (error) {
    if (isNoRowsError(error)) {
      return { id: null, switching: createDefaultSwitchingPreferencesV2(), version: 0 };
    }
    throwIfError(error, "loadSwitching", "switching_preferences");
  }
  if (!data) {
    return { id: null, switching: createDefaultSwitchingPreferencesV2(), version: 0 };
  }
  return {
    id: data.id,
    switching: switchingRowToDomain(data),
    version: data.version
  };
}
async function loadV2Mandate(supabase, householdId) {
  const { data, error } = await supabase.from("household_coverage_mandates").select("*").eq("household_id", householdId).eq("is_current", true).single();
  if (error) {
    if (isNoRowsError(error)) return null;
    throwIfError(error, "loadV2Mandate", "household_coverage_mandates");
  }
  if (!data) return null;
  const [vehicleOverridesResult, propertyOverridesResult] = await Promise.all([
    supabase.from("vehicle_mandate_overrides").select("*").eq("mandate_id", data.id),
    supabase.from("property_mandate_overrides").select("*").eq("mandate_id", data.id)
  ]);
  throwIfError(vehicleOverridesResult.error, "loadV2Mandate", "vehicle_mandate_overrides");
  throwIfError(propertyOverridesResult.error, "loadV2Mandate", "property_mandate_overrides");
  const vehicleOverrides = (vehicleOverridesResult.data ?? []).map((row) => ({
    vehicleId: row.vehicle_id,
    values: canonicalizeStoredMonetaryRules(row.override_values)
  }));
  const propertyOverrides = (propertyOverridesResult.data ?? []).map((row) => ({
    propertyId: row.property_id,
    values: canonicalizeStoredMonetaryRules(row.override_values)
  }));
  const mandate = validateMandate({
    schemaVersion: 2,
    jurisdiction: data.jurisdiction,
    version: data.version,
    effectiveFrom: new Date(data.effective_from).toISOString(),
    householdAutoDefaults: canonicalizeStoredMonetaryRules(data.household_auto_defaults),
    householdPropertyDefaults: canonicalizeStoredMonetaryRules(
      data.household_property_defaults
    ),
    vehicleOverrides,
    propertyOverrides
  });
  return { id: data.id, version: data.version, mandate };
}
async function loadCurrentV2Mandate(supabase, householdId) {
  const [mandateResult, switching] = await Promise.all([
    loadV2Mandate(supabase, householdId),
    loadSwitching(supabase, householdId)
  ]);
  if (!mandateResult) return null;
  if (!switching.id) {
    throw new MandateLoadError(
      "Current mandate exists but switching preferences are missing",
      "loadCurrentV2Mandate",
      "switching_preferences",
      "MISSING_SWITCHING"
    );
  }
  return {
    mandateId: mandateResult.id,
    mandateVersion: mandateResult.version,
    mandate: mandateResult.mandate,
    switchingPreferencesId: switching.id,
    switchingVersion: switching.version,
    switching: switching.switching
  };
}

// ../database/src/quote-normalizer.ts
function first(arr) {
  return arr && arr.length > 0 ? arr[0] : void 0;
}
function toFinancialRating(value) {
  const known = ["unknown", "A_plus", "A", "A_minus", "B_plus", "B_or_lower"];
  return known.includes(value) ? value : "unknown";
}
function toPaymentFrequency(value) {
  const known = ["monthly", "quarterly", "semi_annual", "annual"];
  return known.includes(value) ? value : void 0;
}
function toBillingMethod(value) {
  const known = ["automatic_bank", "credit_card", "mail"];
  return known.includes(value) ? value : void 0;
}
function formatZodIssues(basePath, issues) {
  return issues.map((issue) => `${basePath}.${issue.path.join(".")}: ${issue.message}`).join("; ");
}
function validationErrorMessage(errors) {
  return errors.map((e) => `${e.path?.join(".") ?? ""}: ${e.message}`).join("; ");
}
function toComponent(c) {
  const row = c.quote_coverages.find((r) => r.validation_status !== "superseded");
  if (!row) {
    return {
      quoteId: void 0,
      componentId: c.id,
      productLine: c.product_line,
      message: "Quote component has no active coverage row"
    };
  }
  const coverage = row.coverage;
  const validationStatus = row.validation_status;
  const validationErrors = row.validation_errors ?? [];
  if (validationStatus !== "valid") {
    return {
      quoteId: void 0,
      componentId: c.id,
      productLine: c.product_line,
      message: `Quote component is ${validationStatus}: ${validationErrorMessage(validationErrors)}`
    };
  }
  if (c.product_line === "auto") {
    const parsed2 = AutoCoverageDetails.safeParse(coverage);
    if (!parsed2.success) {
      return {
        quoteId: void 0,
        componentId: c.id,
        productLine: c.product_line,
        message: `Auto coverage validation failed: ${formatZodIssues("auto", parsed2.error.issues)}`
      };
    }
    return {
      id: c.id,
      productLine: "auto",
      assetId: c.asset_id ?? void 0,
      annualPremiumCents: c.annual_premium_cents,
      auto: parsed2.data,
      property: null,
      validationStatus,
      validationErrors
    };
  }
  const parsed = PropertyCoverageDetails.safeParse(coverage);
  if (!parsed.success) {
    return {
      quoteId: void 0,
      componentId: c.id,
      productLine: c.product_line,
      message: `Property coverage validation failed: ${formatZodIssues("property", parsed.error.issues)}`
    };
  }
  return {
    id: c.id,
    productLine: "property",
    assetId: c.asset_id ?? void 0,
    annualPremiumCents: c.annual_premium_cents,
    auto: null,
    property: parsed.data,
    validationStatus,
    validationErrors
  };
}
function toEngineQuote(q) {
  const components = [];
  for (const c of q.quote_policy_components) {
    const result = toComponent(c);
    if ("message" in result) {
      return { ...result, quoteId: q.id };
    }
    components.push(result);
  }
  const insurer = q.insurers;
  const paymentFrequency = first(insurer?.payment_frequencies);
  const billingMethod = first(insurer?.billing_methods);
  const distributionChannel = insurer?.distribution === "broker" ? "broker" : insurer?.distribution === "direct" ? "direct" : void 0;
  return {
    id: q.id,
    insurerId: q.insurer_id,
    insurerName: insurer?.name ?? "Unknown insurer",
    state: q.state,
    isIncumbent: q.is_incumbent,
    policyFeesCents: q.policy_fees_cents,
    paymentFeesCents: q.payment_fees_cents,
    bundleDiscountCents: q.bundle_discount_cents,
    cancellationChargeCents: q.cancellation_charge_cents,
    underwritingConditions: q.underwriting_conditions,
    components,
    expiresAt: q.expires_at,
    paymentFrequency: paymentFrequency ? toPaymentFrequency(paymentFrequency) : void 0,
    billingMethod: billingMethod ? toBillingMethod(billingMethod) : void 0,
    distributionChannel,
    insurerFinancialRating: insurer ? toFinancialRating(insurer.financial_strength_rating) : "unknown"
  };
}

// ../database/src/recommendation-loader.ts
async function loadRecommendationInputSnapshot(supabase, caseId) {
  const { data: caseRow, error: caseError } = await supabase.from("optimization_cases").select("household_id, state").eq("id", caseId).single();
  if (caseError || !caseRow) {
    return {
      code: "CASE_NOT_FOUND",
      message: caseError?.message ?? "Case not found",
      details: { resource: "optimization_cases", operation: "select" }
    };
  }
  const householdId = caseRow.household_id;
  const [mandateResult, vehiclesRes, propertiesRes, quotesRes] = await Promise.all([
    loadCurrentV2Mandate(supabase, householdId).catch((err) => {
      if (err && typeof err === "object" && "code" in err) {
        return {
          code: err.code,
          message: err instanceof Error ? err.message : String(err)
        };
      }
      return { code: "MANDATE_LOAD_FAILED", message: String(err) };
    }),
    supabase.from("vehicles").select("id").eq("household_id", householdId),
    supabase.from("properties").select("id").eq("household_id", householdId),
    supabase.from("quotes").select(
      "id, updated_at, version, insurer_id, state, is_incumbent, policy_fees_cents, payment_fees_cents, bundle_discount_cents, cancellation_charge_cents, underwriting_conditions, expires_at, insurers(name, financial_strength_rating, payment_frequencies, billing_methods, distribution), quote_policy_components(id, product_line, annual_premium_cents, asset_id, quote_coverages(coverage, validation_status, validation_errors, coverage_schema_version, data_source, validated_at, validated_by))"
    ).eq("case_id", caseId)
  ]);
  if (!mandateResult || "code" in mandateResult) {
    return {
      code: mandateResult ? "MANDATE_LOAD_FAILED" : "MANDATE_NOT_FOUND",
      message: mandateResult?.message ?? "No current V2 mandate exists for this household",
      details: { operation: "loadCurrentV2Mandate" }
    };
  }
  if (vehiclesRes.error) {
    return {
      code: "ASSET_LOAD_FAILED",
      message: vehiclesRes.error.message,
      details: { resource: "vehicles", operation: "select" }
    };
  }
  if (propertiesRes.error) {
    return {
      code: "ASSET_LOAD_FAILED",
      message: propertiesRes.error.message,
      details: { resource: "properties", operation: "select" }
    };
  }
  if (quotesRes.error) {
    return {
      code: "QUOTE_LOAD_FAILED",
      message: quotesRes.error.message,
      details: { resource: "quotes", operation: "select" }
    };
  }
  const dbQuotes = quotesRes.data ?? [];
  const engineQuotes = [];
  for (const q of dbQuotes) {
    const result = toEngineQuote(q);
    if ("message" in result) {
      return {
        code: "QUOTE_VALIDATION_FAILED",
        message: result.message,
        details: result
      };
    }
    engineQuotes.push(result);
  }
  const assets = {
    vehicles: (vehiclesRes.data ?? []).map((v) => ({ id: v.id })),
    properties: (propertiesRes.data ?? []).map((p) => ({ id: p.id }))
  };
  return {
    caseId,
    householdId,
    mandateId: mandateResult.mandateId,
    mandateVersion: mandateResult.mandateVersion,
    mandateSchemaVersion: 2,
    jurisdiction: "AB",
    switchingPreferencesId: mandateResult.switchingPreferencesId,
    switchingPreferencesVersion: mandateResult.switchingVersion,
    mandate: mandateResult.mandate,
    switching: mandateResult.switching,
    assets,
    quotes: engineQuotes,
    quoteSnapshot: dbQuotes.map((q) => ({
      id: q.id,
      updated_at: q.updated_at,
      version: q.version,
      is_incumbent: q.is_incumbent
    }))
  };
}
export {
  AutoCoverageDetails,
  EngineRecommendationPersistencePayloadSchema,
  HouseholdCoverageMandateV2,
  PropertyCoverageDetails,
  QuoteComponent,
  QuoteComponentDraft,
  QuoteDataSource,
  QuoteValidationIssue,
  SaveCaseQuoteRequest,
  SwitchingPreferencesV2,
  buildEngineInputFromSnapshot,
  canonicalSerializeRecommendationInput,
  canonicalSerializeRecommendationOutput,
  canonicalizeForDigest,
  evaluateHousehold,
  loadRecommendationInputSnapshot
};
// autopilot-edge-bundle end


export const __AUTOPILOT_SOURCE_HASH__ = "16263236150319eef57083603a09a54710ad9dda1b142ae24f69f37c076c288c";
