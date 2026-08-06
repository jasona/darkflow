<script lang="ts">
  import typia from "typia";

  const validateFixture = typia.createValidate<{ label: string }>();
</script>

<pre>{typeof validateFixture}</pre>
