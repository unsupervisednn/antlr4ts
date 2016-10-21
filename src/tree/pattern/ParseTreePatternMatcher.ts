﻿/*
 * [The "BSD license"]
 * Copyright (c) 2013 Terence Parr
 * Copyright (c) 2013 Sam Harwell
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products
 *    derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR
 * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
 * OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
 * IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT,
 * INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
 * NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

// CONVERSTION complete, Burt Harris 10/14/2016

import { ANTLRInputStream } from "../../ANTLRInputStream";
import { BailErrorStrategy } from "../../BailErrorStrategy";
import { Chunk } from "./Chunk";
import { CommonTokenStream } from "../../CommonTokenStream";
import { Lexer } from '../../Lexer';
import { ListTokenSource } from "../../ListTokenSource";
import { MultiMap } from "../../misc/MultiMap";
import { Nullable, NotNull } from "../../Decorators";
import { ParseCancellationException } from "../../misc/ParseCancellationException";
import { Parser } from '../../Stub_Parser';
import { ParserInterpreter } from "../../Stub_ParserInterpreter";
import { ParserRuleContext } from "../../ParserRuleContext";
import { ParseTree } from "../ParseTree";
import { ParseTreeMatch } from "./ParseTreeMatch";
import { ParseTreePattern } from "./ParseTreePattern";
import { RecognitionException } from "../../RecognitionException";
import { RuleNode } from "../RuleNode";
import { RuleTagToken } from "./RuleTagToken";
import { TagChunk } from "./TagChunk";
import { TerminalNode } from "../TerminalNode";
import { TextChunk } from "./TextChunk";
import { Token } from "../../Token";
import { TokenTagToken } from "./TokenTagToken";

/**
 * A tree pattern matching mechanism for ANTLR {@link ParseTree}s.
 *
 * <p>Patterns are strings of source input text with special tags representing
 * token or rule references such as:</p>
 *
 * <p>{@code <ID> = <expr>;}</p>
 *
 * <p>Given a pattern start rule such as {@code statement}, this object constructs
 * a {@link ParseTree} with placeholders for the {@code ID} and {@code expr}
 * subtree. Then the {@link #match} routines can compare an actual
 * {@link ParseTree} from a parse with this pattern. Tag {@code <ID>} matches
 * any {@code ID} token and tag {@code <expr>} references the result of the
 * {@code expr} rule (generally an instance of {@code ExprContext}.</p>
 *
 * <p>Pattern {@code x = 0;} is a similar pattern that matches the same pattern
 * except that it requires the identifier to be {@code x} and the expression to
 * be {@code 0}.</p>
 *
 * <p>The {@link #matches} routines return {@code true} or {@code false} based
 * upon a match for the tree rooted at the parameter sent in. The
 * {@link #match} routines return a {@link ParseTreeMatch} object that
 * contains the parse tree, the parse tree pattern, and a map from tag name to
 * matched nodes (more below). A subtree that fails to match, returns with
 * {@link ParseTreeMatch#mismatchedNode} set to the first tree node that did not
 * match.</p>
 *
 * <p>For efficiency, you can compile a tree pattern in string form to a
 * {@link ParseTreePattern} object.</p>
 *
 * <p>See {@code TestParseTreeMatcher} for lots of examples.
 * {@link ParseTreePattern} has two static helper methods:
 * {@link ParseTreePattern#findAll} and {@link ParseTreePattern#match} that
 * are easy to use but not super efficient because they create new
 * {@link ParseTreePatternMatcher} objects each time and have to compile the
 * pattern in string form before using it.</p>
 *
 * <p>The lexer and parser that you pass into the {@link ParseTreePatternMatcher}
 * constructor are used to parse the pattern in string form. The lexer converts
 * the {@code <ID> = <expr>;} into a sequence of four tokens (assuming lexer
 * throws out whitespace or puts it on a hidden channel). Be aware that the
 * input stream is reset for the lexer (but not the parser; a
 * {@link ParserInterpreter} is created to parse the input.). Any user-defined
 * fields you have put into the lexer might get changed when this mechanism asks
 * it to scan the pattern string.</p>
 *
 * <p>Normally a parser does not accept token {@code <expr>} as a valid
 * {@code expr} but, from the parser passed in, we create a special version of
 * the underlying grammar representation (an {@link ATN}) that allows imaginary
 * tokens representing rules ({@code <expr>}) to match entire rules. We call
 * these <em>bypass alternatives</em>.</p>
 *
 * <p>Delimiters are {@code <} and {@code >}, with {@code \} as the escape string
 * by default, but you can set them to whatever you want using
 * {@link #setDelimiters}. You must escape both start and stop strings
 * {@code \<} and {@code \>}.</p>
 */
export class ParseTreePatternMatcher {
	/**
	 * This is the backing field for {@link #getLexer()}.
	 */
	private lexer: Lexer;

	/**
	 * This is the backing field for {@link #getParser()}.
	 */
	private parser: Parser; 

	protected start = "<";
	protected stop = ">";
	protected escape = "\\"; // e.g., \< and \> must escape BOTH!

	/**
	 * Regular expression corresponding to escape, for global replace
	 */
	protected escapeRE = /\\/g;

	/**
	 * Constructs a {@link ParseTreePatternMatcher} or from a {@link Lexer} and
	 * {@link Parser} object. The lexer input stream is altered for tokenizing
	 * the tree patterns. The parser is used as a convenient mechanism to get
	 * the grammar name, plus token, rule names.
	 */
	 constructor(lexer: Lexer, parser: Parser)  {
		this.lexer = lexer;
		this.parser = parser;
	}

	/**
	 * Set the delimiters used for marking rule and token tags within concrete
	 * syntax used by the tree pattern parser.
	 *
	 * @param start The start delimiter.
	 * @param stop The stop delimiter.
	 * @param escapeLeft The escape sequence to use for escaping a start or stop delimiter.
	 *
	 * @exception IllegalArgumentException if {@code start} is {@code null} or empty.
	 * @exception IllegalArgumentException if {@code stop} is {@code null} or empty.
	 */
	setDelimiters(start: string, stop: string, escapeLeft: string): void {
		if (!start) {
			throw new Error("start cannot be null or empty");
		}

		if (!stop) {
			throw new Error("stop cannot be null or empty");
		}

		this.start = start;
		this.stop = stop;
		this.escape = escapeLeft;
		this.escapeRE = new RegExp(escapeLeft.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "g");
	}

	/** Does {@code pattern} matched as rule {@code patternRuleIndex} match {@code tree}? */
	matches(tree: ParseTree, pattern: string, patternRuleIndex: number): boolean;

	/** Does {@code pattern} matched as rule patternRuleIndex match tree? Pass in a
	 *  compiled pattern instead of a string representation of a tree pattern.
	 */
	matches(tree: ParseTree, pattern: ParseTreePattern): boolean;

	matches(tree: ParseTree, pattern: string | ParseTreePattern, patternRuleIndex: number = 0): boolean {
		if (typeof pattern === "string") {
			let p: ParseTreePattern = this.compile(pattern, patternRuleIndex);
			return this.matches(tree, p);
		} else {
			let labels = new MultiMap<string, ParseTree>();
			let mismatchedNode = this.matchImpl(tree, pattern.getPatternTree(), labels);
			return !mismatchedNode;
		}
	}

	/**
	 * Compare {@code pattern} matched as rule {@code patternRuleIndex} against
	 * {@code tree} and return a {@link ParseTreeMatch} object that contains the
	 * matched elements, or the node at which the match failed.
	 */
	match(tree: ParseTree, pattern: string, patternRuleIndex: number): ParseTreeMatch;

	/**
	 * Compare {@code pattern} matched against {@code tree} and return a
	 * {@link ParseTreeMatch} object that contains the matched elements, or the
	 * node at which the match failed. Pass in a compiled pattern instead of a
	 * string representation of a tree pattern.
	 */
	match(tree: ParseTree, pattern: ParseTreePattern): ParseTreeMatch;

	// Implementation of match
	@NotNull
	match(tree: ParseTree, @NotNull pattern: string | ParseTreePattern, patternRuleIndex: number = 0): ParseTreeMatch {
		if (typeof pattern == "string") {
			let p: ParseTreePattern = this.compile(pattern, patternRuleIndex);
			return this.match(tree, p);
		} else {
			let labels = new MultiMap<string, ParseTree>();
			let mismatchedNode = this.matchImpl(tree, pattern.getPatternTree(), labels);
			return new ParseTreeMatch(tree, pattern, labels, mismatchedNode);
		}
	}

	/**
	 * For repeated use of a tree pattern, compile it to a
	 * {@link ParseTreePattern} using this method.
	 */
	compile(pattern: string, patternRuleIndex: number): ParseTreePattern {
		let tokenList = this.tokenize(pattern);
		let tokenSrc =  new ListTokenSource(tokenList);
		let tokens = new CommonTokenStream(tokenSrc);
		const parser = this.parser;

		let parserInterp = new ParserInterpreter(
				parser.getGrammarFileName(),
				parser.getVocabulary(),
				parser.getRuleNames(),
				parser.getATNWithBypassAlts(),
				tokens);

		let tree: ParseTree;
		try {
			parserInterp.setErrorHandler(new BailErrorStrategy());
			tree = parserInterp.parse(patternRuleIndex);
//			System.out.println("pattern tree = "+tree.toStringTree(parserInterp));
		} catch (e) {
			if (e instanceof ParseCancellationException) {
				throw e.getCause();
			} else if (e instanceof RecognitionException) {
				throw e;
			} else {
				throw new ParseTreePatternMatcher.CannotInvokeStartRule(e);
			}
		}

		// Make sure tree pattern compilation checks for a complete parse
		if ( tokens.LA(1)!==Token.EOF ) {
			throw new ParseTreePatternMatcher.StartRuleDoesNotConsumeFullPattern();
		}

		return new ParseTreePattern(this, pattern, patternRuleIndex, tree);
	}

	/**
	 * Used to convert the tree pattern string into a series of tokens. The
	 * input stream is reset.
	 */
	@NotNull
	getLexer(): Lexer {
		return this.lexer;
	}

	/**
	 * Used to collect to the grammar file name, token names, rule names for
	 * used to parse the pattern into a parse tree.
	 */
	@NotNull
	getParser(): Parser {
		return this.parser;
	}

	// ---- SUPPORT CODE ----

	/**
	 * Recursively walk {@code tree} against {@code patternTree}, filling
	 * {@code match.}{@link ParseTreeMatch#labels labels}.
	 *
	 * @return the first node encountered in {@code tree} which does not match
	 * a corresponding node in {@code patternTree}, or {@code null} if the match
	 * was successful. The specific node returned depends on the matching
	 * algorithm used by the implementation, and may be overridden.
	 */
	protected matchImpl(
		@NotNull tree: ParseTree, 
		@NotNull patternTree: ParseTree,
		@NotNull labels: MultiMap<string, ParseTree> ): ParseTree | undefined
	{
		if (!tree) {
			throw new TypeError("tree cannot be null");
		}

		if (!patternTree) {
			throw new TypeError("patternTree cannot be null");
		}

		// x and <ID>, x and y, or x and x; or could be mismatched types
		if (tree instanceof TerminalNode && patternTree instanceof TerminalNode) {
			let mismatchedNode: ParseTree | undefined = undefined;
			// both are tokens and they have same type
			if ( tree.getSymbol().getType() === patternTree.getSymbol().getType() ) {
				if ( patternTree.getSymbol() instanceof TokenTagToken ) { // x and <ID>
					let tokenTagToken = patternTree.getSymbol() as TokenTagToken;
					// track label->list-of-nodes for both token name and label (if any)
					labels.map(tokenTagToken.getTokenName(), tree);
					const l = tokenTagToken.getLabel();
					if (l) {
						labels.map(l, tree);
					}
				}
				else if ( tree.getText()===patternTree.getText() ) {
					// x and x
				}
				else {
					// x and y
					if (!mismatchedNode) {
						mismatchedNode = tree;
					}
				}
			}
			else {
				if (!mismatchedNode) {
					mismatchedNode = tree;
				}
			}

			return mismatchedNode;
		}

		if (tree instanceof ParserRuleContext
			&& patternTree instanceof ParserRuleContext) {
			let mismatchedNode: ParseTree | undefined = undefined;
			// (expr ...) and <expr>
			let ruleTagToken = this.getRuleTagToken(patternTree);
			if ( ruleTagToken ) {
				let m: ParseTreeMatch;
				if ( tree.getRuleContext().getRuleIndex() === patternTree.getRuleContext().getRuleIndex() ) {
					// track label->list-of-nodes for both rule name and label (if any)
					labels.map(ruleTagToken.getRuleName(), tree);
					const l = ruleTagToken.getLabel();
					if ( l ) {
						labels.map(l, tree);
					}
				}
				else {
					if (!mismatchedNode) {
						mismatchedNode = tree;
					}
				}

				return mismatchedNode;
			}

			// (expr ...) and (expr ...)
			if ( tree.getChildCount() !== patternTree.getChildCount() ) {
				if (!mismatchedNode) {
					mismatchedNode = tree;
				}

				return mismatchedNode;
			}

			let n: number =  tree.getChildCount();
			for (let i = 0; i<n; i++) {
				let childMatch = this.matchImpl(tree.getChild(i), patternTree.getChild(i), labels);
				if ( childMatch ) {
					return childMatch;
				}
			}

			return mismatchedNode;
		}

		// if nodes aren't both tokens or both rule nodes, can't match
		return tree;
	}

	/** Is {@code t} {@code (expr <expr>)} subtree? */
	protected getRuleTagToken(t: ParseTree): RuleTagToken | undefined {
		if (t instanceof RuleNode) {
			if (t.getChildCount() === 1 && t.getChild(0) instanceof TerminalNode) {
				let c = t.getChild(0) as TerminalNode;
				if (c.getSymbol() instanceof RuleTagToken) {
//					System.out.println("rule tag subtree "+t.toStringTree(parser));
					return c.getSymbol() as RuleTagToken;
				}
			}
		}
		return undefined;
	}

	tokenize(pattern: string): Token[] {
		// split pattern into chunks: sea (raw input) and islands (<ID>, <expr>)
		let chunks = this.split(pattern);

		// create token stream from text and tags
		let tokens: Token[] = [];

		for (let chunk of chunks) {
			if ( chunk instanceof TagChunk ) {
				let tagChunk = chunk;
				const firstChar = tagChunk.getTag().substr(0, 1);
				// add special rule token or conjure up new token from name
				if ( firstChar === firstChar.toUpperCase()) {
					let ttype: number =  this.parser.getTokenType(tagChunk.getTag());
					if (ttype === Token.INVALID_TYPE) {
						throw new Error("Unknown token " + tagChunk.getTag() + " in pattern: " + pattern);
					}
					let t: TokenTagToken = new TokenTagToken(tagChunk.getTag(), ttype, tagChunk.getLabel());
					tokens.push(t);
				}
				else if ( firstChar === firstChar.toLowerCase()) {
					let ruleIndex: number = this.parser.getRuleIndex(tagChunk.getTag());
					if ( ruleIndex===-1 ) {
						throw new Error("Unknown rule "+tagChunk.getTag()+" in pattern: "+pattern);
					}
					let ruleImaginaryTokenType: number =  this.parser.getATNWithBypassAlts().ruleToTokenType[ruleIndex];
					tokens.push(new RuleTagToken(tagChunk.getTag(), ruleImaginaryTokenType, tagChunk.getLabel()));
				}
				else {
					throw new Error("invalid tag: "+tagChunk.getTag()+" in pattern: "+pattern);
				}
			}
			else {
				let textChunk = chunk as TextChunk;
				let input = new ANTLRInputStream(textChunk.getText());
				this.lexer.setInputStream(input);
				let t: Token = this.lexer.nextToken();
				while (t.getType() !== Token.EOF) {
					tokens.push(t);
					t = this.lexer.nextToken();
				}
			}
		}

//		System.out.println("tokens="+tokens);
		return tokens;
	}

	/** Split {@code <ID> = <e:expr> ;} into 4 chunks for tokenizing by {@link #tokenize}. */
	split(pattern: string): Chunk[] {
		let p: number =  0;
		let n: number =  pattern.length;
		let chunks: Chunk[] = [];
		let buf: "";
		// find all start and stop indexes first, then collect
		let starts: number[] = [];
		let stops: number[] = [];
		while ( p<n ) {
			if ( p === pattern.indexOf(this.escape + this.start, p) ) {
				p += this.escape.length + this.start.length;
			}
			else if (p === pattern.indexOf(this.escape + this.stop, p) ) {
				p += this.escape.length + this.stop.length;
			}
			else if (p === pattern.indexOf(this.start,p) ) {
				starts.push(p);
				p += this.start.length;
			}
			else if (p === pattern.indexOf(this.stop,p) ) {
				stops.push(p);
				p += this.stop.length;
			}
			else {
				p++;
			}
		}

//		System.out.println("");
//		System.out.println(starts);
//		System.out.println(stops);
		if ( starts.length > stops.length) {
			throw new Error("unterminated tag in pattern: "+pattern);
		}

		if ( starts.length < stops.length ) {
			throw new Error("missing start tag in pattern: "+pattern);
		}

		let ntags: number = starts.length;
		for (let i = 0; i < ntags; i++) {
			if (starts[i] >= stops[i]) {
				throw new Error("tag delimiters out of order in pattern: " + pattern);
			}
		}

		// collect into chunks now
		if (ntags === 0) {
			let text: string = pattern.substring(0, n);
			chunks.push(new TextChunk(text));
		}

		if (ntags > 0 && starts[0] > 0) { // copy text up to first tag into chunks
			let text: string = pattern.substring(0, starts[0]);
			chunks.push(new TextChunk(text));
		}
		for (let i=0; i<ntags; i++) {
			// copy inside of <tag>
			let tag: string =  pattern.substring(starts[i] + this.start.length, stops[i]);
			let ruleOrToken: string =  tag;
			let label: string | undefined = undefined;
			let colon: number =  tag.indexOf(':');
			if ( colon >= 0 ) {
				label = tag.substring(0,colon);
				ruleOrToken = tag.substring(colon+1, tag.length);
			}
			chunks.push(new TagChunk(ruleOrToken, label));
			if ( i+1 < ntags ) {
				// copy from end of <tag> to start of next
				let text: string =  pattern.substring(stops[i] + this.stop.length, starts[i + 1]);
				chunks.push(new TextChunk(text));
			}
		}
		if ( ntags>0 ) {
			let afterLastTag: number =  stops[ntags - 1] + this.stop.length;
			if ( afterLastTag < n ) { // copy text from end of last tag to end
				let text: string =  pattern.substring(afterLastTag, n);
				chunks.push(new TextChunk(text));
			}
		}

		// strip out the escape sequences from text chunks but not tags
		for (let i = 0; i < chunks.length; i++) {
			let c: Chunk =  chunks[i];
			if ( c instanceof TextChunk ) {
				let unescaped: string = c.getText().replace(this.escapeRE, "");
				if (unescaped.length < c.getText().length) {
					chunks[i] = new TextChunk(unescaped);
				}
			}
		}

		return chunks;
	}
}

export namespace ParseTreePatternMatcher {
	export class CannotInvokeStartRule extends Error {
		public constructor(public error: Error) {
			super(`CannotInvokeStartRule: ${error}`);
		}
	}

	// Fixes https://github.com/antlr/antlr4/issues/413
	// "Tree pattern compilation doesn't check for a complete parse"
	export class StartRuleDoesNotConsumeFullPattern extends Error {
		constructor() {
			super("StartRuleDoesNotConsumeFullPattern");
		}
	}
}