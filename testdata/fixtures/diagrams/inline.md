# Inline Diagrams

Valid Mermaid:

```mermaid
graph TD
  A --> B
```

Invalid Mermaid:

```mermaid
graph TD
  A --> --> ((
```

Valid D2:

```d2
a -> b
```

Invalid D2:

```d2
a -> {
```
