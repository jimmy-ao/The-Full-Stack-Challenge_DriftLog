# iam

resource "aws_iam_role" "api" {
  name = local.iam_role_api_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "api" {
  name   = local.iam_policy_api_name
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}