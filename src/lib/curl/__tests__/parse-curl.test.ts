import { describe, it, expect } from "vitest";

import { parseCurl } from "@/lib/curl/parse-curl";
import { authOf } from "@/lib/workspace/model";

function expectOk(text: string) {
  const result = parseCurl(text);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`expected parse to succeed: ${result.error}`);
  }
  return result.request;
}

describe("parseCurl - method/url/headers (AC-005)", () => {
  // AC-005, TC-003 - behavior: -X method, positional url, and -H rows extracted.
  it("should extract the -X method, positional url, and -H headers", () => {
    const req = expectOk(
      "curl -X POST 'https://api.example.com/widgets' -H 'A: 1' -d 'x=1'",
    );

    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://api.example.com/widgets");
    expect(req.headers).toEqual([{ key: "A", value: "1", enabled: true }]);
    expect(req.body).toBe("x=1");
  });

  // AC-005 - behavior: --request and --url long forms work like -X / positional.
  it("should read the method from --request and the url from --url", () => {
    const req = expectOk("curl --request PUT --url 'https://x.test/a'");

    expect(req.method).toBe("PUT");
    expect(req.url).toBe("https://x.test/a");
  });

  // AC-005 - behavior: --header long form yields a header row too.
  it("should read a header from the --header long form", () => {
    const req = expectOk(
      "curl 'https://x.test' --header 'Accept: application/json'",
    );

    expect(req.headers).toEqual([
      { key: "Accept", value: "application/json", enabled: true },
    ]);
  });

  // edge (spec §8) - behavior: a lowercase method is normalized to upper case.
  it("should normalize a lowercase -X method to upper case", () => {
    const req = expectOk("curl -X post 'https://x.test'");

    expect(req.method).toBe("POST");
  });

  // edge (spec §8) - behavior: an unrecognized method falls back to the
  // data-presence default rather than erroring; with no data that is GET.
  it("should fall back to the data-presence default if -X is not a known method", () => {
    const req = expectOk("curl -X FROBNICATE 'https://x.test'");

    expect(req.method).toBe("GET");
  });

  // TC-007, AC-008 - behavior: -X QUERY is a known method now, so it is kept.
  it("should keep -X QUERY as the method", () => {
    const req = expectOk("curl -X QUERY 'https://example.org'");

    expect(req.method).toBe("QUERY");
    expect(req.url).toBe("https://example.org");
  });

  // AC-008 - behavior: --request QUERY long form is kept too.
  it("should keep --request QUERY as the method", () => {
    const req = expectOk("curl --request QUERY --url 'https://example.org'");

    expect(req.method).toBe("QUERY");
  });
});

describe("parseCurl - data flags + method default (AC-006)", () => {
  // AC-006, TC-004 - behavior: multiple data flags are joined with '&'.
  it("should join multiple -d data flags with '&'", () => {
    const req = expectOk("curl 'https://x.test' -d 'a=1' -d 'b=2'");

    expect(req.body).toBe("a=1&b=2");
  });

  // AC-006 - behavior: every data-flag alias contributes to the body.
  it("should treat --data / --data-raw / --data-binary / --data-urlencode as body", () => {
    const req = expectOk(
      "curl 'https://x.test' --data 'a=1' --data-raw 'b=2' --data-binary 'c=3' --data-urlencode 'd=4'",
    );

    expect(req.body).toBe("a=1&b=2&c=3&d=4");
  });

  // AC-006, TC-004 - behavior: a data flag with no -X defaults the method to POST.
  it("should default the method to POST if a data flag is present and no -X is given", () => {
    const req = expectOk("curl 'https://x.test' -d 'a=1'");

    expect(req.method).toBe("POST");
  });

  // AC-006, TC-004 - behavior: no data and no -X defaults to GET.
  it("should default the method to GET if there is no data flag and no -X", () => {
    const req = expectOk("curl 'https://x.test'");

    expect(req.method).toBe("GET");
    expect(req.body).toBeNull();
  });

  // AC-006 - behavior: an explicit -X always wins over the data-presence default.
  it("should keep an explicit -X GET even when a data flag is present", () => {
    const req = expectOk("curl -X GET 'https://x.test' -d 'a=1'");

    expect(req.method).toBe("GET");
    expect(req.body).toBe("a=1");
  });
});

describe("parseCurl - tokenizer / shell quoting (AC-007)", () => {
  // AC-007, TC-003 - behavior: a multi-line, backslash-continued curl parses
  // identically to the same command on one line.
  it("should parse a backslash-newline multi-line curl identically to one line", () => {
    const multi =
      "curl -X POST 'https://api.example.com/widgets' \\\n" +
      "  -H 'A: 1' \\\n" +
      "  -d 'x=1'";
    const single =
      "curl -X POST 'https://api.example.com/widgets' -H 'A: 1' -d 'x=1'";

    expect(parseCurl(multi)).toEqual(parseCurl(single));
  });

  // AC-007, TC-007 - behavior: a single-quoted value with spaces is one token.
  it("should tokenize a single-quoted header value with spaces as one value", () => {
    const req = expectOk(
      "curl 'https://x.test' -H 'Authorization: Bearer a b'",
    );

    expect(req.headers).toEqual([
      { key: "Authorization", value: "Bearer a b", enabled: true },
    ]);
  });

  // AC-007 - behavior: double quotes group a value literally (no var expansion).
  it("should tokenize a double-quoted value as one literal token", () => {
    const req = expectOk('curl "https://x.test/a b" -H "X: y z"');

    expect(req.url).toBe("https://x.test/a b");
    expect(req.headers).toEqual([{ key: "X", value: "y z", enabled: true }]);
  });

  // AC-007, TC-007 - behavior: a '\''-escaped single quote round-trips into the
  // literal value (the POSIX close-escape-reopen idiom).
  it("should fold a '\\''-escaped single quote back into the value", () => {
    const req = expectOk("curl 'https://x.test' -H 'X: it'\\''s'");

    expect(req.headers).toEqual([
      { key: "X", value: "it's", enabled: true },
    ]);
  });

  // AC-007 - behavior: a leading '$' (as in a copied '$ curl ...') is tolerated.
  it("should tolerate a leading $ before curl", () => {
    const req = expectOk("$ curl 'https://x.test'");

    expect(req.url).toBe("https://x.test");
  });
});

describe("parseCurl - auth / cookie / unknown flags (AC-008)", () => {
  // AC-008, TC-005 - behavior: -u user:pass maps to basic auth.
  it("should map -u user:pass to basic auth", () => {
    const req = expectOk("curl 'https://x.test' -u user:pw");

    expect(req.auth).toEqual(
      authOf({ active: "basic", username: "user", password: "pw" }),
    );
  });

  // AC-008 - behavior: --user long form maps to basic auth too.
  it("should map --user long form to basic auth", () => {
    const req = expectOk("curl 'https://x.test' --user 'admin:s3cret'");

    expect(req.auth).toEqual(
      authOf({ active: "basic", username: "admin", password: "s3cret" }),
    );
  });

  // AC-008, TC-005 - behavior: -b maps to a Cookie header row.
  it("should map -b to a Cookie header", () => {
    const req = expectOk("curl 'https://x.test' -b 'k=v'");

    expect(req.headers).toContainEqual({
      key: "Cookie",
      value: "k=v",
      enabled: true,
    });
  });

  // AC-008 - behavior: --cookie long form maps to a Cookie header too.
  it("should map --cookie to a Cookie header", () => {
    const req = expectOk("curl 'https://x.test' --cookie 'session=abc'");

    expect(req.headers).toContainEqual({
      key: "Cookie",
      value: "session=abc",
      enabled: true,
    });
  });

  // AC-008, TC-005 - behavior: unknown flags are skipped, never fatal.
  it("should ignore unknown flags like --compressed and -L without failing", () => {
    const req = expectOk(
      "curl --compressed -L -k -s -v -i 'https://x.test' -H 'A: 1'",
    );

    expect(req.url).toBe("https://x.test");
    expect(req.headers).toEqual([{ key: "A", value: "1", enabled: true }]);
  });
});

describe("parseCurl - failure cases (AC-009)", () => {
  // AC-009, TC-006 - behavior: empty input has no url -> ok:false.
  it("should return ok:false for empty input", () => {
    const result = parseCurl("");

    expect(result.ok).toBe(false);
  });

  // AC-009, TC-006 - behavior: whitespace-only input has no url -> ok:false.
  it("should return ok:false for whitespace-only input", () => {
    const result = parseCurl("   \n  ");

    expect(result.ok).toBe(false);
  });

  // AC-009, TC-006 - behavior: a bare 'curl' with no url -> ok:false.
  it("should return ok:false for a bare curl with no url", () => {
    const result = parseCurl("curl");

    expect(result.ok).toBe(false);
  });

  // AC-009, TC-006 - behavior: a url present -> ok:true.
  it("should return ok:true if a url is present", () => {
    const result = parseCurl("curl 'http://x'");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.url).toBe("http://x");
    }
  });
});
