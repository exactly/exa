---
name: composition-patterns
description: react composition patterns for scalable components. use when refactoring boolean prop proliferation, building component libraries, or designing reusable apis.
version: "1.0.0"
metadata:
  repository: "https://github.com/vercel-labs/agent-skills"
  url: "https://github.com/vercel-labs/agent-skills/tree/a5343bd/skills/composition-patterns"
---

# react composition patterns

composition patterns for building flexible, maintainable react components. avoid boolean prop proliferation by using compound components, lifting state, and composing internals.

## when to apply

reference these guidelines when:

- refactoring components with many boolean props
- building reusable component libraries
- designing flexible component apis
- reviewing component architecture
- working with compound components or context providers

## rule categories by priority

| priority | category                | impact | prefix          |
| -------- | ----------------------- | ------ | --------------- |
| 1        | component architecture  | high   | `architecture-` |
| 2        | state management        | medium | `state-`        |
| 3        | implementation patterns | medium | `patterns-`     |
| 4        | react 19 apis           | medium | `react19-`      |

---

## 1. component architecture (high)

### avoid boolean prop proliferation

don't add boolean props like `isThread`, `isEditing`, `isDMThread` to customize component behavior. each boolean doubles possible states and creates unmaintainable conditional logic. use composition instead.

**incorrect (boolean props create exponential complexity):**

```tsx
function Composer({
  onSubmit,
  isThread,
  channelId,
  isDMThread,
  dmId,
  isEditing,
  isForwarding,
}: Props) {
  return (
    <form>
      <Header />
      <Input />
      {isDMThread ? (
        <AlsoSendToDMField id={dmId} />
      ) : isThread ? (
        <AlsoSendToChannelField id={channelId} />
      ) : null}
      {isEditing ? (
        <EditActions />
      ) : isForwarding ? (
        <ForwardActions />
      ) : (
        <DefaultActions />
      )}
      <Footer onSubmit={onSubmit} />
    </form>
  )
}
```

**correct (composition eliminates conditionals):**

```tsx
function ChannelComposer() {
  return (
    <Composer.Frame>
      <Composer.Header />
      <Composer.Input />
      <Composer.Footer>
        <Composer.Attachments />
        <Composer.Formatting />
        <Composer.Emojis />
        <Composer.Submit />
      </Composer.Footer>
    </Composer.Frame>
  )
}

function ThreadComposer({ channelId }: { channelId: string }) {
  return (
    <Composer.Frame>
      <Composer.Header />
      <Composer.Input />
      <AlsoSendToChannelField id={channelId} />
      <Composer.Footer>
        <Composer.Formatting />
        <Composer.Emojis />
        <Composer.Submit />
      </Composer.Footer>
    </Composer.Frame>
  )
}

function EditComposer() {
  return (
    <Composer.Frame>
      <Composer.Input />
      <Composer.Footer>
        <Composer.Formatting />
        <Composer.Emojis />
        <Composer.CancelEdit />
        <Composer.SaveEdit />
      </Composer.Footer>
    </Composer.Frame>
  )
}
```

each variant is explicit about what it renders. share internals without sharing a single monolithic parent.

### use compound components

structure complex components as compound components with a shared context. each subcomponent accesses shared state via context, not props. consumers compose the pieces they need.

**incorrect (monolithic component with render props):**

```tsx
function Composer({
  renderHeader,
  renderFooter,
  renderActions,
  showAttachments,
  showFormatting,
  showEmojis,
}: Props) {
  return (
    <form>
      {renderHeader?.()}
      <Input />
      {showAttachments && <Attachments />}
      {renderFooter ? (
        renderFooter()
      ) : (
        <Footer>
          {showFormatting && <Formatting />}
          {showEmojis && <Emojis />}
          {renderActions?.()}
        </Footer>
      )}
    </form>
  )
}
```

**correct (compound components with shared context):**

```tsx
const ComposerContext = createContext<ComposerContextValue | null>(null)

function ComposerProvider({ children, state, actions, meta }: ProviderProps) {
  return (
    <ComposerContext value={{ state, actions, meta }}>
      {children}
    </ComposerContext>
  )
}

function ComposerFrame({ children }: { children: React.ReactNode }) {
  return <form>{children}</form>
}

function ComposerInput() {
  const {
    state,
    actions: { update },
    meta: { inputRef },
  } = use(ComposerContext)
  return (
    <TextInput
      ref={inputRef}
      value={state.input}
      onChangeText={(text) => update((s) => ({ ...s, input: text }))}
    />
  )
}

function ComposerSubmit() {
  const {
    actions: { submit },
  } = use(ComposerContext)
  return <Button onPress={submit}>Send</Button>
}

const Composer = {
  Provider: ComposerProvider,
  Frame: ComposerFrame,
  Input: ComposerInput,
  Submit: ComposerSubmit,
  Header: ComposerHeader,
  Footer: ComposerFooter,
  Attachments: ComposerAttachments,
  Formatting: ComposerFormatting,
  Emojis: ComposerEmojis,
}
```

---

## 2. state management (medium)

### define generic context interfaces for dependency injection

define a generic interface for your component context with three parts: `state`, `actions`, and `meta`. this interface is a contract that any provider can implement—enabling the same ui components to work with completely different state implementations.

**core principle:** lift state, compose internals, make state dependency-injectable.

**incorrect (ui coupled to specific state implementation):**

```tsx
function ComposerInput() {
  const { input, setInput } = useChannelComposerState()
  return <TextInput value={input} onChangeText={setInput} />
}
```

**correct (generic interface enables dependency injection):**

```tsx
interface ComposerState {
  input: string
  attachments: Attachment[]
  isSubmitting: boolean
}

interface ComposerActions {
  update: (updater: (state: ComposerState) => ComposerState) => void
  submit: () => void
}

interface ComposerMeta {
  inputRef: React.RefObject<TextInput>
}

interface ComposerContextValue {
  state: ComposerState
  actions: ComposerActions
  meta: ComposerMeta
}

const ComposerContext = createContext<ComposerContextValue | null>(null)
```

**ui components consume the interface, not the implementation:**

```tsx
function ComposerInput() {
  const {
    state,
    actions: { update },
    meta,
  } = use(ComposerContext)

  return (
    <TextInput
      ref={meta.inputRef}
      value={state.input}
      onChangeText={(text) => update((s) => ({ ...s, input: text }))}
    />
  )
}
```

**different providers implement the same interface:**

```tsx
function ForwardMessageProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState(initialState)
  const inputRef = useRef(null)
  const submit = useForwardMessage()

  return (
    <ComposerContext
      value={{
        state,
        actions: { update: setState, submit },
        meta: { inputRef },
      }}
    >
      {children}
    </ComposerContext>
  )
}

function ChannelProvider({ channelId, children }: Props) {
  const { state, update, submit } = useGlobalChannel(channelId)
  const inputRef = useRef(null)

  return (
    <ComposerContext
      value={{
        state,
        actions: { update, submit },
        meta: { inputRef },
      }}
    >
      {children}
    </ComposerContext>
  )
}
```

### lift state into provider components

move state management into dedicated provider components. this allows sibling components outside the main ui to access and modify state without prop drilling or awkward refs.

**incorrect (state trapped inside component):**

```tsx
function ForwardMessageComposer() {
  const [state, setState] = useState(initialState)
  const forwardMessage = useForwardMessage()

  return (
    <Composer.Frame>
      <Composer.Input />
      <Composer.Footer />
    </Composer.Frame>
  )
}

function ForwardMessageDialog() {
  return (
    <Dialog>
      <ForwardMessageComposer />
      <MessagePreview /> {/* needs composer state */}
      <DialogActions>
        <CancelButton />
        <ForwardButton /> {/* needs to call submit */}
      </DialogActions>
    </Dialog>
  )
}
```

**correct (state lifted to provider):**

```tsx
function ForwardMessageProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState(initialState)
  const forwardMessage = useForwardMessage()
  const inputRef = useRef(null)

  return (
    <Composer.Provider
      state={state}
      actions={{ update: setState, submit: forwardMessage }}
      meta={{ inputRef }}
    >
      {children}
    </Composer.Provider>
  )
}

function ForwardMessageDialog() {
  return (
    <ForwardMessageProvider>
      <Dialog>
        <ForwardMessageComposer />
        <MessagePreview />
        <DialogActions>
          <CancelButton />
          <ForwardButton />
        </DialogActions>
      </Dialog>
    </ForwardMessageProvider>
  )
}

function ForwardButton() {
  const { actions } = use(Composer.Context)
  return <Button onPress={actions.submit}>Forward</Button>
}
```

**key insight:** components that need shared state don't have to be visually nested inside each other—they just need to be within the same provider.

### decouple state management from ui

the provider component should be the only place that knows how state is managed. ui components consume the context interface—they don't know if state comes from `useState`, zustand, or a server sync.

---

## 3. implementation patterns (medium)

### create explicit component variants

instead of one component with many boolean props, create explicit variant components. each variant composes the pieces it needs. the code documents itself.

**incorrect (one component, many modes):**

```tsx
<Composer
  isThread
  isEditing={false}
  channelId='abc'
  showAttachments
  showFormatting={false}
/>
```

**correct (explicit variants):**

```tsx
<ThreadComposer channelId="abc" />
<EditMessageComposer messageId="xyz" />
<ForwardMessageComposer messageId="123" />
```

each implementation is unique, explicit and self-contained. yet they can each use shared parts.

### prefer children over render props

use `children` for composition instead of `renderX` props. children are more readable, compose naturally, and don't require understanding callback signatures.

**incorrect (render props):**

```tsx
<Composer
  renderHeader={() => <CustomHeader />}
  renderFooter={() => (
    <>
      <Formatting />
      <Emojis />
    </>
  )}
  renderActions={() => <SubmitButton />}
/>
```

**correct (compound components with children):**

```tsx
<Composer.Frame>
  <CustomHeader />
  <Composer.Input />
  <Composer.Footer>
    <Composer.Formatting />
    <Composer.Emojis />
    <SubmitButton />
  </Composer.Footer>
</Composer.Frame>
```

**when render props are appropriate:**

```tsx
<List
  data={items}
  renderItem={({ item, index }) => <Item item={item} index={index} />}
/>
```

use render props when the parent needs to provide data or state to the child. use children when composing static structure.

---

## 4. react 19 apis (medium)

> **note:** react 19+ only. skip this section if using react 18 or earlier.

in react 19, `ref` is now a regular prop (no `forwardRef` wrapper needed), and `use()` replaces `useContext()`.

**incorrect (forwardRef in react 19):**

```tsx
const ComposerInput = forwardRef<TextInput, Props>((props, ref) => {
  return <TextInput ref={ref} {...props} />
})
```

**correct (ref as a regular prop):**

```tsx
function ComposerInput({ ref, ...props }: Props & { ref?: React.Ref<TextInput> }) {
  return <TextInput ref={ref} {...props} />
}
```

**incorrect (useContext in react 19):**

```tsx
const value = useContext(MyContext)
```

**correct (use instead of useContext):**

```tsx
const value = use(MyContext)
```

`use()` can also be called conditionally, unlike `useContext()`.
